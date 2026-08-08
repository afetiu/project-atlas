/**
 * Standalone counterpart to `extension/panel/ArchitecturePanel.ts` — the same
 * message-handling orchestration (canvas edit → persist, detect → AI →
 * persist, apply → codegen → diff, …), reimplemented over plain Node/fs
 * instead of the VS Code webview/workspace APIs. One session per running
 * `atlas-studio` process, broadcasting to every connected browser tab.
 *
 * Deliberately deferred vs. the VS Code extension (v1 scope trim, not a
 * silent omission — see the atlas-architecture-mcp README):
 *   - `auth:configure` has no native input box; it returns guidance instead.
 *   - `open:file` has no external editor to hand off to; it's a no-op.
 *   - MCP server registry comes from `ATLAS_MCP_SERVERS` (JSON), not settings.
 */

import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

import type { ChatTurn } from '../shared/ai/chat';
import { detectedToModel } from '../shared/ai/detection';
import type {
  AiJob,
  ChangeProposal,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../shared/messaging/protocol';
import { diffModels, isEmptyDelta, summarizeDelta } from '../shared/model/diff';
import { createEmptyModel, type ArchitectureModel } from '../shared/model/types';
import { validateModel } from '../shared/serialization/validation';
import { applyLayout, deserializeModel } from '../shared/serialization/yaml';
import { AiError, type AgentEvent, type ArchitectureAgent } from '../extension/ai/agent';
import type { AiAuth } from '../extension/ai/AuthProvider';
import type { AgentResolution, ResolveAgentOptions } from '../extension/ai/engineResolution';
import { verifyCodegen } from '../extension/ai/verify';
import { computeDrift } from '../extension/workspace/drift';
import {
  getFileAtCommit,
  getFileHistory,
  getHeadCommit,
  getWorkingTreeDiff,
  revertFiles,
} from '../extension/workspace/git';
import { resolveWithinRoot } from '../extension/workspace/paths';
import { McpBridge, type McpServerRegistry } from '../extension/mcp/McpBridge';
import { extractArchitecture } from '../shared/extract/staticExtract';
import { mergeExtraction } from '../shared/extract/merge';
import { matchDocsToComponents, type DocMeta } from '../shared/docs/catalog';
import { excerptOf, extractHeadings, extractTitle } from '../shared/docs/markdown';
import {
  assessPlan,
  deserializePlan,
  planFileName,
  planProgress,
  renderAdr,
  serializePlan,
  type Plan,
  type PlanSummary,
} from '../shared/plans/plan';
import { AtlasWriteConflictError, StandaloneFileService } from './StandaloneFileService';
import { StandaloneBaselineStore } from './StandaloneBaselineStore';
import { StandaloneRepoWatcher } from './StandaloneRepoWatcher';
import type { Logger } from './StandaloneLogger';
import { walkFiles, readTextFiles } from './fsWalk';

const SOURCE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SOURCE_EXCLUDE = /\.d\.ts$|\.(test|spec)\./;

export interface StudioSessionOptions {
  cwd: string;
  resolveAgent: (options?: ResolveAgentOptions) => Promise<AgentResolution>;
  logger: Logger;
  auth: AiAuth;
}

export class StudioSession {
  private readonly fileService: StandaloneFileService;
  private readonly baseline: StandaloneBaselineStore;
  private readonly repoWatcher: StandaloneRepoWatcher;
  private readonly clients = new Set<{ send(data: string): void }>();
  private mcpBridge: McpBridge | undefined;

  private abortController: AbortController | undefined;
  private busy = false;
  private lastWebviewEditAt = 0;
  private lastApply: { baseline: ArchitectureModel; files: string[] } | undefined;

  constructor(private readonly deps: StudioSessionOptions) {
    this.fileService = new StandaloneFileService(deps.cwd);
    this.baseline = new StandaloneBaselineStore(deps.cwd);
    this.fileService.onDidChangeExternally(() => void this.pushModelToWebview());
    this.repoWatcher = new StandaloneRepoWatcher(
      deps.cwd,
      () => void this.onRepoChanged(),
      (message) => this.deps.logger.info(message),
    );
  }

  /* ------------------------------ clients -------------------------------- */

  addClient(client: { send(data: string): void }): void {
    this.clients.add(client);
  }

  removeClient(client: { send(data: string): void }): void {
    this.clients.delete(client);
  }

  private post(message: HostToWebviewMessage): void {
    const text = JSON.stringify(message);
    for (const client of this.clients) {
      client.send(text);
    }
  }

  /* -------------------------- message handling -------------------------- */

  async handleMessage(message: WebviewToHostMessage): Promise<void> {
    if (!message || typeof (message as { type?: unknown }).type !== 'string') {
      return;
    }
    switch (message.type) {
      case 'webview:ready':
        await this.pushModelToWebview(true);
        await this.pushEngineStatus();
        break;
      case 'model:changed':
        this.lastWebviewEditAt = Date.now();
        await this.persistModel(message.model);
        await this.pushSyncStatus(message.model);
        break;
      case 'ai:detect':
        await this.runDetect();
        break;
      case 'code:map':
        await this.runMapFromCode();
        break;
      case 'chat:send':
        await this.runChat(message.message, message.history);
        break;
      case 'apply:request':
        await this.runApply(message.model, message.instruction);
        break;
      case 'apply:revert':
        await this.runRevert();
        break;
      case 'ai:cancel':
        this.abortController?.abort();
        break;
      case 'auth:configure':
        // No native input box outside an editor — point at the env-var path.
        this.post({
          type: 'ai:error',
          code: 'auth',
          message:
            'atlas-studio has no in-app key entry yet. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, ' +
            'or GEMINI_API_KEY in your environment and restart atlas-studio.',
        });
        break;
      case 'open:file':
        // No external editor to hand off to in a browser tab — deliberately a no-op.
        break;
      case 'mcp:listTools':
        await this.runMcpListTools(message.nodeId, message.server);
        break;
      case 'mcp:callTool':
        await this.runMcpCallTool(message.nodeId, message.server, message.tool, message.args);
        break;
      case 'docs:scan':
        await this.runDocsScan();
        break;
      case 'docs:read':
        if (typeof message.path === 'string') {
          await this.runDocsRead(message.path);
        }
        break;
      case 'plan:list':
        await this.pushPlanEntries();
        break;
      case 'plan:save':
        await this.runPlanSave(message.file, message.plan);
        break;
      case 'plan:load':
        await this.runPlanLoad(message.file);
        break;
      case 'plan:rename':
        await this.runPlanRename(message.from, message.to, message.plan);
        break;
      case 'plan:adr':
        await this.runPlanAdr(message.file, message.plan);
        break;
      case 'history:list': {
        const entries = await getFileHistory(this.deps.cwd, 'atlas.yaml');
        this.post({ type: 'history:entries', entries: entries.slice(0, 200) });
        break;
      }
      case 'history:load':
        if (typeof message.sha === 'string') {
          await this.runHistoryLoad(message.sha);
        }
        break;
      case 'history:exit':
        await this.pushModelToWebview(true);
        break;
    }
  }

  private async runHistoryLoad(sha: string): Promise<void> {
    try {
      const text = await getFileAtCommit(this.deps.cwd, sha, 'atlas.yaml');
      if (text === null) {
        this.post({ type: 'model:error', message: 'That commit has no atlas.yaml.' });
        return;
      }
      let model = deserializeModel(text);
      const layout = await getFileAtCommit(this.deps.cwd, sha, 'atlas.layout.yaml');
      model = applyLayout(model, layout ?? '');
      this.post({ type: 'model:loaded', model });
    } catch (error) {
      this.deps.logger.error(`Time-lapse load failed: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Could not load that snapshot.' });
    }
  }

  private async runDocsScan(): Promise<void> {
    try {
      const files = await walkFiles(this.deps.cwd, '', /\.md$/i, 400);
      const texts = await readTextFiles(files);
      const docs: DocMeta[] = texts.map(({ path, content }) => {
        const fallback = path.split('/').pop()!.replace(/\.md$/i, '');
        return {
          path,
          title: extractTitle(content, fallback),
          excerpt: excerptOf(content),
          headings: extractHeadings(content).slice(0, 40),
        };
      });
      const { model } = await this.fileService.read();
      this.post({ type: 'docs:list', docs: matchDocsToComponents(docs, model) });
    } catch (error) {
      this.deps.logger.error(`Docs scan failed: ${String(error)}`);
      this.post({ type: 'docs:list', docs: [] });
    }
  }

  private async runDocsRead(path: string): Promise<void> {
    const safe = resolveWithinRoot(this.deps.cwd, path);
    if (!safe || !/\.md$/i.test(safe)) {
      this.post({ type: 'docs:content', path, error: 'Not a readable document.' });
      return;
    }
    try {
      this.post({ type: 'docs:content', path, text: await readFile(safe, 'utf8') });
    } catch (error) {
      this.post({ type: 'docs:content', path, error: messageOf(error) });
    }
  }

  private mcp(): McpBridge {
    const registry = parseMcpRegistry(process.env.ATLAS_MCP_SERVERS);
    if (!this.mcpBridge) {
      this.mcpBridge = new McpBridge(registry);
    } else {
      this.mcpBridge.setRegistry(registry);
    }
    return this.mcpBridge;
  }

  private async runMcpListTools(nodeId: string, server: string): Promise<void> {
    try {
      const tools = await this.mcp().listTools(server);
      this.post({ type: 'mcp:tools', nodeId, server, tools });
    } catch (error) {
      this.deps.logger.error(`MCP listTools(${server}) failed: ${String(error)}`);
      this.post({ type: 'mcp:tools', nodeId, server, error: messageOf(error) });
    }
  }

  private async runMcpCallTool(
    nodeId: string,
    server: string,
    tool: string,
    args: Record<string, unknown> | undefined,
  ): Promise<void> {
    try {
      const result = await this.mcp().callTool(server, tool, args ?? {});
      this.post({ type: 'mcp:toolResult', nodeId, tool, ok: result.ok, text: result.text });
    } catch (error) {
      this.deps.logger.error(`MCP callTool(${server}.${tool}) failed: ${String(error)}`);
      this.post({ type: 'mcp:toolResult', nodeId, tool, ok: false, text: messageOf(error) });
    }
  }

  /* ----------------------------- AI workflows ---------------------------- */

  private async runDetect(label = 'Analyzing repository…'): Promise<void> {
    if (!this.begin('detect', label)) {
      return;
    }
    try {
      const { model: previous } = await this.fileService.read();
      const model = await this.runWithEngine('detect', label, (agent) =>
        agent.detect(this.deps.cwd, (event) => this.relay('detect', event), this.abortController!, previous),
      );
      this.deps.logger.info(
        `Detection complete: ${model.nodes.length} components, ${model.edges.length} connections.`,
      );
      await this.fileService.write(model);
      await this.baseline.set(model);
      await this.baseline.setCommit(await getHeadCommit(this.deps.cwd));
      this.post({ type: 'model:loaded', model });
      await this.pushSyncStatus(model);
      await this.pushDriftStatus(model);
    } catch (error) {
      this.reportAiError(error);
    } finally {
      this.end();
    }
  }

  /* ------------------------------- plans -------------------------------- */

  private plansDir(): string {
    return join(this.deps.cwd, 'atlas', 'plans');
  }

  private planPath(file: string): string | null {
    const base = file.split('/').pop() ?? '';
    if (!/^[a-z0-9][a-z0-9-]*\.yaml$/i.test(base)) {
      return null;
    }
    return join(this.plansDir(), base);
  }

  private async pushPlanEntries(): Promise<void> {
    const plans: PlanSummary[] = [];
    let current: ArchitectureModel | null = null;
    try {
      current = (await this.fileService.read()).model;
    } catch {
      // unreadable atlas.yaml — entries still list, just without progress
    }
    try {
      const entries = await readdir(this.plansDir(), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.yaml')) {
          continue;
        }
        try {
          const text = await readFile(join(this.plansDir(), entry.name), 'utf8');
          const plan = deserializePlan(text);
          const progress =
            plan.baseline && current
              ? (({ done, total }) => ({ done, total }))(planProgress(plan.baseline, plan.target, current))
              : undefined;
          plans.push({
            file: entry.name,
            name: plan.name,
            status: plan.status,
            createdAt: plan.createdAt,
            ...(progress && progress.total > 0 ? { progress } : {}),
          });
        } catch {
          // unreadable plan — skip
        }
      }
    } catch {
      // no plans directory yet — empty list
    }
    plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    this.post({ type: 'plan:entries', plans });
  }

  private async runPlanSave(file: string | undefined, plan: Plan): Promise<void> {
    const target = this.planPath(file ?? planFileName(plan.name));
    if (!target) {
      this.post({ type: 'model:error', message: 'Invalid plan file name.' });
      return;
    }
    try {
      await mkdir(this.plansDir(), { recursive: true });
      await writeFile(target, serializePlan(plan), 'utf8');
      const base = target.split(/[/\\]/).pop()!;
      this.deps.logger.info(`Plan saved: atlas/plans/${base} (${plan.status}).`);
      this.post({ type: 'plan:saved', file: base });
      await this.pushPlanEntries();
    } catch (error) {
      this.deps.logger.error(`Plan save failed: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Atlas could not save the plan.' });
    }
  }

  private async runPlanLoad(file: string): Promise<void> {
    const target = this.planPath(file);
    if (!target) {
      return;
    }
    try {
      const plan = deserializePlan(await readFile(target, 'utf8'));
      this.post({ type: 'plan:loaded', file: target.split(/[/\\]/).pop()!, plan });
    } catch (error) {
      this.deps.logger.error(`Plan load failed: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Atlas could not open that plan.' });
    }
  }

  private async runPlanRename(from: string, to: string, plan: Plan): Promise<void> {
    const source = this.planPath(from);
    const target = this.planPath(to);
    if (!source || !target || source === target) {
      return;
    }
    try {
      await mkdir(this.plansDir(), { recursive: true });
      await writeFile(target, serializePlan(plan), 'utf8');
      await unlink(source).catch(() => undefined); // old file already gone — the write above is what matters
      const base = target.split(/[/\\]/).pop()!;
      this.deps.logger.info(`Plan renamed: atlas/plans/${from} → atlas/plans/${base}.`);
      this.post({ type: 'plan:saved', file: base });
      await this.pushPlanEntries();
    } catch (error) {
      this.deps.logger.error(`Plan rename failed: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Atlas could not rename the plan file.' });
    }
  }

  private async runPlanAdr(file: string, plan: Plan): Promise<void> {
    const target = this.planPath(file);
    if (!target) {
      return;
    }
    try {
      await mkdir(this.plansDir(), { recursive: true });
      const { model: base } = await this.fileService.read();
      const assessment = assessPlan(base, plan.target);

      const adrDir = join(this.deps.cwd, 'docs', 'adr');
      await mkdir(adrDir, { recursive: true });
      let next = 1;
      for (const entry of await readdir(adrDir)) {
        const m = entry.match(/^adr-(\d+)/i) ?? entry.match(/^(\d+)-/);
        if (m) {
          next = Math.max(next, Number(m[1]) + 1);
        }
      }
      const adrName = `adr-${String(next).padStart(3, '0')}-${planFileName(plan.name).replace(/\.yaml$/, '')}.md`;
      const markdown = renderAdr({ number: next, plan, base, assessment });
      await writeFile(join(adrDir, adrName), markdown, 'utf8');

      const decided: Plan = { ...plan, status: 'decided', baseline: base };
      await writeFile(target, serializePlan(decided), 'utf8');

      const path = `docs/adr/${adrName}`;
      this.deps.logger.info(`Decision record written: ${path}.`);
      this.post({ type: 'plan:adrSaved', file: target.split(/[/\\]/).pop()!, path });
      await this.pushPlanEntries();
    } catch (error) {
      this.deps.logger.error(`ADR generation failed: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Atlas could not write the decision record.' });
    }
  }

  private async runMapFromCode(): Promise<void> {
    this.post({ type: 'ai:status', busy: true, job: 'detect', label: 'Mapping from code…' });
    try {
      const located = await this.resolveSourceRoot();
      if (!located) {
        this.deps.logger.info(
          'Map from code: no JavaScript/TypeScript sources found. For other languages, use "Detect with AI" instead.',
        );
        this.post({ type: 'ai:status', busy: false });
        return;
      }
      const { root, files } = located;
      const sourceFiles = await readTextFiles(
        files.filter((f) => !SOURCE_EXCLUDE.test(f.absolute)),
      );
      const extracted = extractArchitecture(sourceFiles, { sourceRoot: root, depth: 2 });
      const { model: current } = await this.fileService.read();
      const merged = mergeExtraction(current, extracted);
      await this.fileService.write(merged);
      await this.baseline.set(merged);
      await this.baseline.setCommit(await getHeadCommit(this.deps.cwd));
      this.deps.logger.info(
        `Mapped from code: ${merged.nodes.length} components, ${merged.edges.length} dependencies.`,
      );
      this.post({ type: 'model:loaded', model: merged });
      await this.pushSyncStatus(merged);
      await this.pushDriftStatus(merged);
    } catch (error) {
      this.deps.logger.error(`Map from code failed: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Atlas could not map this repository from code.' });
    } finally {
      this.post({ type: 'ai:status', busy: false });
    }
  }

  private async runWithEngine<T>(
    job: AiJob,
    baseLabel: string,
    run: (agent: ArchitectureAgent) => Promise<T>,
  ): Promise<T> {
    const first = await this.deps.resolveAgent();
    this.post({ type: 'ai:status', busy: true, job, label: `${baseLabel} · ${first.label}` });
    try {
      return await run(first.agent);
    } catch (error) {
      const launchFailure =
        first.engine === 'claude-code' && error instanceof AiError && error.code === 'auth';
      if (!launchFailure) {
        throw error;
      }
      let fallback: AgentResolution;
      try {
        fallback = await this.deps.resolveAgent({ skipClaudeCode: true });
      } catch {
        throw error;
      }
      this.deps.logger.info(
        `Claude Code engine failed (${(error as Error).message}) — retrying via ${fallback.label}.`,
      );
      this.post({ type: 'ai:status', busy: true, job, label: `${baseLabel} · ${fallback.label}` });
      return await run(fallback.agent);
    }
  }

  private async pushEngineStatus(): Promise<void> {
    try {
      const { label } = await this.deps.resolveAgent();
      this.post({ type: 'ai:engine', configured: true, label });
    } catch {
      this.post({ type: 'ai:engine', configured: false });
    }
  }

  /**
   * Find where the code lives, mirroring the extension's zero-config probing:
   * `ATLAS_SOURCE_ROOT` wins when it has sources, else common roots are
   * probed, else the top-level directory with the most source files.
   */
  private async resolveSourceRoot(): Promise<{ root: string; files: Awaited<ReturnType<typeof walkFiles>> } | null> {
    const configured = process.env.ATLAS_SOURCE_ROOT?.trim();
    const candidates = [
      ...new Set(
        [configured, 'src', 'lib', 'app', 'apps', 'server', 'api', 'services', 'packages', 'client'].filter(
          (c): c is string => !!c,
        ),
      ),
    ];
    for (const candidate of candidates) {
      const files = await walkFiles(this.deps.cwd, candidate, SOURCE_PATTERN);
      if (files.length > 0) {
        this.deps.logger.info(`Map from code: using source root "${candidate}".`);
        return { root: candidate, files };
      }
    }

    const all = await walkFiles(this.deps.cwd, '', SOURCE_PATTERN);
    const byTopDir = new Map<string, typeof all>();
    for (const file of all) {
      const top = file.path.includes('/') ? file.path.slice(0, file.path.indexOf('/')) : '';
      if (!top) {
        continue; // loose top-level files can't form a component root
      }
      byTopDir.set(top, [...(byTopDir.get(top) ?? []), file]);
    }
    const best = [...byTopDir.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (best) {
      this.deps.logger.info(`Map from code: auto-detected source root "${best[0]}".`);
      return { root: best[0], files: best[1] };
    }
    return null;
  }

  private async onRepoChanged(): Promise<void> {
    const { model } = await this.fileService.read();
    await this.pushDriftStatus(model);
    await this.pushRulesConfig();

    const autoSync = /^(1|true)$/i.test(process.env.ATLAS_AUTO_SYNC ?? '');
    if (!autoSync || this.busy) {
      return;
    }
    if (Date.now() - this.lastWebviewEditAt < 4000) {
      return;
    }
    const base = this.baseline.get() ?? model;
    if (!isEmptyDelta(diffModels(base, model))) {
      return;
    }
    await this.runDetect('Syncing from code…');
  }

  private async pushDriftStatus(model: ArchitectureModel): Promise<void> {
    const drifted = await computeDrift(this.deps.cwd, model, this.baseline.getCommit());
    this.post({ type: 'drift:status', driftedNodeIds: drifted });
  }

  private async pushRulesConfig(): Promise<void> {
    let text = '';
    try {
      text = await readFile(join(this.deps.cwd, 'atlas.rules.yaml'), 'utf8');
    } catch {
      text = ''; // no custom rules file — built-ins only
    }
    this.post({ type: 'rules:config', text });
  }

  private async runChat(message: string, history: ChatTurn[]): Promise<void> {
    if (!this.begin('chat', 'Thinking…')) {
      return;
    }
    try {
      const { model } = await this.fileService.read();
      const response = await this.runWithEngine('chat', 'Thinking…', (agent) =>
        agent.chat(
          this.deps.cwd,
          model,
          history,
          message,
          (text) => this.post({ type: 'chat:token', text }),
          this.abortController!,
        ),
      );
      let proposal: ChangeProposal | undefined;
      if (response.proposal && response.proposal.nodes?.length) {
        const target = detectedToModel(
          { nodes: response.proposal.nodes, edges: response.proposal.edges },
          { preservePositionsFrom: model },
        );
        if (validateModel(target).valid && target.nodes.length > 0) {
          proposal = { summary: response.proposal.summary, model: target };
        } else {
          this.deps.logger.info('Discarded an invalid chat proposal.');
        }
      }
      this.post({ type: 'chat:reply', reply: response.reply, proposal });
    } catch (error) {
      this.reportAiError(error);
    } finally {
      this.end();
    }
  }

  private async runApply(target: ArchitectureModel, instruction?: string): Promise<void> {
    const validation = validateModel(target);
    if (!validation.valid) {
      this.post({ type: 'model:error', message: 'Cannot apply an invalid architecture.', issues: validation.issues });
      return;
    }
    if (!this.begin('codegen', 'Generating code…')) {
      return;
    }
    try {
      await this.fileService.write(target);
      this.post({ type: 'model:loaded', model: target });

      const base = this.baseline.get() ?? createEmptyModel();
      const delta = diffModels(base, target);
      if (isEmptyDelta(delta)) {
        await this.baseline.set(target);
        this.post({
          type: 'apply:done',
          summary: 'No code-relevant changes.',
          diff: '',
          revertable: false,
          verification: { ok: true, checks: [] },
        });
        await this.pushSyncStatus(target);
        return;
      }

      this.deps.logger.info(`Code generation started for ${summarizeDelta(delta).length} change(s).`);
      const result = await this.runWithEngine('codegen', 'Generating code…', (agent) =>
        agent.generateCode(
          this.deps.cwd,
          delta,
          target,
          instruction,
          (event) => this.relay('codegen', event),
          this.abortController!,
        ),
      );
      const diff = await getWorkingTreeDiff(this.deps.cwd, result.touchedFiles);
      this.lastApply = { baseline: base, files: result.touchedFiles };

      const verification = await verifyCodegen(this.deps.cwd, delta, target, {
        command: process.env.ATLAS_VERIFY_COMMAND,
        // Running atlas-studio against a folder is itself an affirmative trust
        // signal — there's no separate VS Code-style workspace-trust prompt.
        trusted: true,
        touchedFiles: result.touchedFiles,
      });
      this.deps.logger.info(
        `Code generation complete: ${result.touchedFiles.length} file(s) touched, verification ${verification.ok ? 'PASSED' : 'FAILED'}.`,
      );
      if (verification.ok) {
        await this.baseline.set(target);
      }
      this.post({
        type: 'apply:done',
        summary: result.summary,
        diff,
        revertable: result.touchedFiles.length > 0,
        verification,
      });
      await this.pushSyncStatus(target);
      await this.pushDriftStatus(target);
    } catch (error) {
      this.reportAiError(error);
    } finally {
      this.end();
    }
  }

  private async runRevert(): Promise<void> {
    if (this.busy || !this.lastApply) {
      this.post({ type: 'apply:reverted', ok: false });
      return;
    }
    const { baseline, files } = this.lastApply;
    this.lastApply = undefined;
    try {
      await revertFiles(this.deps.cwd, files);
      await this.baseline.set(baseline);
      const { model } = await this.fileService.read();
      await this.pushSyncStatus(model);
      this.deps.logger.info(`Reverted ${files.length} generated file(s).`);
      this.post({ type: 'apply:reverted', ok: true });
    } catch (error) {
      this.deps.logger.error(`Revert failed: ${String(error)}`);
      this.post({ type: 'apply:reverted', ok: false });
    }
  }

  /* ------------------------------- helpers ------------------------------ */

  private async persistModel(model: ArchitectureModel): Promise<void> {
    const result = validateModel(model);
    if (!result.valid) {
      this.post({ type: 'model:error', message: 'Changes were not saved because the model is invalid.', issues: result.issues });
      return;
    }
    try {
      await this.fileService.write(model);
    } catch (error) {
      if (error instanceof AtlasWriteConflictError) {
        this.deps.logger.info('Write conflict on atlas.yaml — reloading the on-disk version.');
        await this.pushModelToWebview(true);
        this.post({
          type: 'model:error',
          message:
            'atlas.yaml changed outside this session, so the latest version was reloaded. Your last edit was not saved — redo it on the current map.',
        });
        return;
      }
      this.deps.logger.error(`Failed to save atlas.yaml: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Atlas could not save your changes to disk.' });
    }
  }

  private async pushModelToWebview(force = false): Promise<void> {
    if (!force && Date.now() - this.lastWebviewEditAt < 2000) {
      this.deps.logger.info('Skipped an external reload to preserve an in-flight edit.');
      return;
    }
    const { model, error, readOnly } = await this.fileService.read();
    if (error) {
      this.post({ type: 'model:error', message: error });
      return;
    }
    if (readOnly) {
      this.post({
        type: 'model:error',
        message: 'This atlas.yaml was written by a newer version of Atlas. It is read-only until you update.',
      });
    }
    if (!this.baseline.get()) {
      await this.baseline.set(model);
    }
    if (!this.baseline.getCommit()) {
      await this.baseline.setCommit(await getHeadCommit(this.deps.cwd));
    }
    this.post({ type: 'model:loaded', model });
    await this.pushSyncStatus(model);
    await this.pushDriftStatus(model);
    await this.pushRulesConfig();
  }

  private async pushSyncStatus(model: ArchitectureModel): Promise<void> {
    const base = this.baseline.get() ?? createEmptyModel();
    const delta = diffModels(base, model);
    this.post({ type: 'sync:status', pendingSummary: summarizeDelta(delta) });
  }

  private relay(job: AiJob, event: AgentEvent): void {
    const line = event.kind === 'tool' ? `${event.name}${event.detail ? ` ${event.detail}` : ''}` : event.text;
    if (line.trim()) {
      this.post({ type: 'ai:progress', job, line: line.trim() });
    }
  }

  private begin(job: AiJob, label: string): boolean {
    if (this.busy) {
      this.post({ type: 'ai:error', code: 'failed', message: 'An AI task is already running.' });
      return false;
    }
    this.busy = true;
    this.abortController = new AbortController();
    this.post({ type: 'ai:status', busy: true, job, label });
    return true;
  }

  private end(): void {
    this.busy = false;
    this.abortController = undefined;
    this.post({ type: 'ai:status', busy: false });
  }

  private reportAiError(error: unknown): void {
    this.deps.logger.error(error instanceof Error ? error.message : String(error));
    if (error instanceof AiError) {
      this.post({ type: 'ai:error', code: error.code, message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'AI task failed.';
    if (/abort/i.test(message)) {
      this.post({ type: 'ai:error', code: 'cancelled', message: 'Task cancelled.' });
      return;
    }
    if (/ENOENT|spawn|not found|no such file/i.test(message)) {
      this.post({
        type: 'ai:error',
        code: 'failed',
        message: 'Claude CLI not found. Install Claude Code, set ATLAS_CLAUDE_PATH, or set an API key.',
      });
      return;
    }
    this.post({ type: 'ai:error', code: 'failed', message });
  }

  dispose(): void {
    this.abortController?.abort();
    void this.mcpBridge?.dispose();
    this.fileService.dispose();
    this.repoWatcher.dispose();
    this.clients.clear();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseMcpRegistry(raw: string | undefined): McpServerRegistry {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as McpServerRegistry;
  } catch {
    return {};
  }
}

