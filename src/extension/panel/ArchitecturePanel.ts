/**
 * Manages the Atlas webview panel and orchestrates the AI workflows.
 *
 * The panel is the bridge between three collaborators — the file service
 * (atlas.yaml), the Claude agent (AI), and the baseline store (what the code
 * currently reflects) — and the webview UI. It translates messages in both
 * directions and keeps the canvas, the file, and the code in sync:
 *
 *   canvas edit    → model:changed → write atlas.yaml + recompute pending diff
 *   external edit  → file watcher  → model:loaded → webview
 *   detect         → AI analysis   → write atlas.yaml + set baseline
 *   apply          → AI code-gen   → git diff + advance baseline
 */

import { relative } from 'path';

import * as vscode from 'vscode';

import type { ChatTurn } from '../../shared/ai/chat';
import { detectedToModel } from '../../shared/ai/detection';
import type {
  AiJob,
  ChangeProposal,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../../shared/messaging/protocol';
import { diffModels, isEmptyDelta, summarizeDelta } from '../../shared/model/diff';
import { createEmptyModel, type ArchitectureModel } from '../../shared/model/types';
import { validateModel } from '../../shared/serialization/validation';
import { applyLayout, deserializeModel } from '../../shared/serialization/yaml';
import { AiError, type AgentEvent } from '../ai/agent';
import type { AgentResolution } from '../ai/agentFactory';
import { verifyCodegen } from '../ai/verify';
import type { Logger } from '../log';
import { BaselineStore } from '../workspace/BaselineStore';
import { AtlasFileService } from '../workspace/AtlasFileService';
import { RepoWatcher } from '../workspace/RepoWatcher';
import { computeDrift } from '../workspace/drift';
import { getFileAtCommit, getFileHistory, getHeadCommit, getWorkingTreeDiff, revertFiles } from '../workspace/git';
import { resolveWithinRoot } from '../workspace/paths';
import { McpBridge, type McpServerRegistry } from '../mcp/McpBridge';
import { extractArchitecture } from '../../shared/extract/staticExtract';
import { mergeExtraction } from '../../shared/extract/merge';
import { matchDocsToComponents, type DocMeta } from '../../shared/docs/catalog';
import { excerptOf, extractHeadings, extractTitle } from '../../shared/docs/markdown';
import {
  assessPlan,
  deserializePlan,
  planFileName,
  renderAdr,
  serializePlan,
  type Plan,
  type PlanSummary,
} from '../../shared/plans/plan';
import { buildWebviewHtml } from './webviewHtml';

export interface PanelDependencies {
  extensionUri: vscode.Uri;
  fileService: AtlasFileService;
  /** Resolved per AI job so provider/setting changes apply without a reload. */
  resolveAgent: () => Promise<AgentResolution>;
  baseline: BaselineStore;
  workspaceFolder: vscode.WorkspaceFolder;
  cwd: string;
  logger: Logger;
}

export class ArchitecturePanel {
  public static readonly viewType = 'atlas.architecture';
  private static current: ArchitecturePanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private abortController: AbortController | undefined;
  private busy = false;
  /** Timestamp of the last edit received from the webview, for auto-sync safety. */
  private lastWebviewEditAt = 0;
  /** State needed to revert the most recent code generation. */
  private lastApply: { baseline: ArchitectureModel; files: string[] } | undefined;
  /** Lazily-created bridge to configured MCP servers, for operable nodes. */
  private mcpBridge: McpBridge | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: PanelDependencies,
  ) {
    this.panel.webview.html = buildWebviewHtml(this.panel.webview, this.deps.extensionUri);
    this.disposables.push(
      this.deps.fileService,
      new RepoWatcher(this.deps.workspaceFolder, () => void this.onRepoChanged()),
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m) => this.handleMessage(m)),
      this.deps.fileService.onDidChangeExternally(() => this.pushModelToWebview()),
    );
  }

  static createOrShow(deps: PanelDependencies): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (ArchitecturePanel.current) {
      deps.fileService.dispose();
      ArchitecturePanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ArchitecturePanel.viewType,
      'Atlas Architecture',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'dist')],
      },
    );
    ArchitecturePanel.current = new ArchitecturePanel(panel, deps);
  }

  /** Trigger detection from a command, revealing the panel first. */
  static detect(): void {
    void ArchitecturePanel.current?.runDetect();
  }

  /* -------------------------- message handling -------------------------- */

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    // The webview is our own bundle, but messages cross a trust boundary, so
    // validate the envelope shape at runtime rather than trusting the static
    // type. Anything malformed is dropped.
    if (!message || typeof (message as { type?: unknown }).type !== 'string') {
      return;
    }
    switch (message.type) {
      case 'webview:ready':
        // The webview just (re)mounted with no state — always load, even if an
        // edit was recently in flight before a reload.
        await this.pushModelToWebview(true);
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
        await vscode.commands.executeCommand('atlas.setApiKey');
        break;
      case 'open:file':
        if (typeof message.path === 'string') {
          await this.openMappedPath(message.path);
        }
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

  /** Show the map as it was at a commit. View-only: the webview shields edits. */
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

  /** Catalogue the workspace's Markdown docs for the Docs panel. */
  private async runDocsScan(): Promise<void> {
    try {
      const uris = await vscode.workspace.findFiles(
        '**/*.md',
        '**/{node_modules,dist,dist-test,out,build,coverage,.git}/**',
        400,
      );
      const docs: DocMeta[] = [];
      for (const uri of uris) {
        const path = relative(this.deps.cwd, uri.fsPath).replace(/\\/g, '/');
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.byteLength > 512 * 1024) {
            continue; // not documentation-sized
          }
          const text = new TextDecoder().decode(bytes);
          const fallback = path.split('/').pop()!.replace(/\.md$/i, '');
          docs.push({
            path,
            title: extractTitle(text, fallback),
            excerpt: excerptOf(text),
            headings: extractHeadings(text).slice(0, 40),
          });
        } catch {
          // unreadable file — skip it
        }
      }
      const { model } = await this.deps.fileService.read();
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
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(safe));
      this.post({ type: 'docs:content', path, text: new TextDecoder().decode(bytes) });
    } catch (error) {
      this.post({ type: 'docs:content', path, error: messageOf(error) });
    }
  }

  /** Lazily build the MCP bridge from the user's `atlas.mcpServers` setting. */
  private mcp(): McpBridge {
    const registry =
      vscode.workspace.getConfiguration('atlas').get<McpServerRegistry>('mcpServers') ?? {};
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

  /** Open a mapped file, or reveal it in the Explorer if it's a directory. */
  private async openMappedPath(relativePath: string): Promise<void> {
    // `relativePath` originates from a node's mapping.path, which can come from
    // AI detection, the MCP server, or a checked-in atlas.yaml in an untrusted
    // repo. Confine it to the workspace (symlink-aware) before opening anything,
    // so a crafted `../../../etc/passwd` can't open arbitrary files.
    const safe = resolveWithinRoot(this.deps.cwd, relativePath);
    if (!safe) {
      void vscode.window.showWarningMessage(
        `Atlas refused to open a path outside the workspace: "${relativePath}".`,
      );
      return;
    }
    const uri = vscode.Uri.file(safe);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        await vscode.commands.executeCommand('revealInExplorer', uri);
      } else {
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    } catch {
      void vscode.window.showWarningMessage(`Atlas could not find "${relativePath}".`);
    }
  }

  /* ----------------------------- AI workflows ---------------------------- */

  private async runDetect(label = 'Analyzing repository…'): Promise<void> {
    if (!this.begin('detect', label)) {
      return;
    }
    try {
      const { agent, label: engine } = await this.deps.resolveAgent();
      this.post({ type: 'ai:status', busy: true, job: 'detect', label: `${label} · ${engine}` });
      this.deps.logger.info(`Detection started (${label}) via ${engine}.`);
      // Preserve the current layout so re-running detection doesn't reshuffle
      // the canvas — only the architecture content is refreshed.
      const { model: previous } = await this.deps.fileService.read();
      const model = await agent.detect(
        this.deps.cwd,
        (event) => this.relay('detect', event),
        this.abortController!,
        previous,
      );
      this.deps.logger.info(
        `Detection complete: ${model.nodes.length} components, ${model.edges.length} connections.`,
      );
      await this.deps.fileService.write(model);
      await this.deps.baseline.set(model);
      // Drift is measured from the detection commit: this is "now in sync".
      await this.deps.baseline.setCommit(await getHeadCommit(this.deps.cwd));
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

  private plansDirUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.deps.workspaceFolder.uri, 'atlas', 'plans');
  }

  /** Resolve a plan file name safely inside atlas/plans (basename only). */
  private planUri(file: string): vscode.Uri | null {
    const base = file.split('/').pop() ?? '';
    if (!/^[a-z0-9][a-z0-9-]*\.yaml$/i.test(base)) {
      return null;
    }
    return vscode.Uri.joinPath(this.plansDirUri(), base);
  }

  private async pushPlanEntries(): Promise<void> {
    const plans: PlanSummary[] = [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.plansDirUri());
      for (const [name, kind] of entries) {
        if (kind !== vscode.FileType.File || !name.endsWith('.yaml')) {
          continue;
        }
        try {
          const bytes = await vscode.workspace.fs.readFile(
            vscode.Uri.joinPath(this.plansDirUri(), name),
          );
          const plan = deserializePlan(new TextDecoder().decode(bytes));
          plans.push({ file: name, name: plan.name, status: plan.status, createdAt: plan.createdAt });
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
    const target = this.planUri(file ?? planFileName(plan.name));
    if (!target) {
      this.post({ type: 'model:error', message: 'Invalid plan file name.' });
      return;
    }
    try {
      await vscode.workspace.fs.createDirectory(this.plansDirUri());
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(serializePlan(plan)));
      const base = target.path.split('/').pop()!;
      this.deps.logger.info(`Plan saved: atlas/plans/${base} (${plan.status}).`);
      this.post({ type: 'plan:saved', file: base });
      await this.pushPlanEntries();
    } catch (error) {
      this.deps.logger.error(`Plan save failed: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Atlas could not save the plan.' });
    }
  }

  private async runPlanLoad(file: string): Promise<void> {
    const target = this.planUri(file);
    if (!target) {
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(target);
      const plan = deserializePlan(new TextDecoder().decode(bytes));
      this.post({ type: 'plan:loaded', file: target.path.split('/').pop()!, plan });
    } catch (error) {
      this.deps.logger.error(`Plan load failed: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Atlas could not open that plan.' });
    }
  }

  /** Write the plan's decision record into docs/adr/ and mark the plan decided. */
  private async runPlanAdr(file: string, plan: Plan): Promise<void> {
    const target = this.planUri(file);
    if (!target) {
      return;
    }
    try {
      // Persist the plan as decided first, so the file and the record agree
      // even if a debounced save is still in flight.
      await vscode.workspace.fs.createDirectory(this.plansDirUri());
      const { model: base } = await this.deps.fileService.read();
      const assessment = assessPlan(base, plan.target);

      const adrDir = vscode.Uri.joinPath(this.deps.workspaceFolder.uri, 'docs', 'adr');
      await vscode.workspace.fs.createDirectory(adrDir);
      let next = 1;
      for (const [name] of await vscode.workspace.fs.readDirectory(adrDir)) {
        const m = name.match(/^adr-(\d+)/i) ?? name.match(/^(\d+)-/);
        if (m) {
          next = Math.max(next, Number(m[1]) + 1);
        }
      }
      const adrName = `adr-${String(next).padStart(3, '0')}-${planFileName(plan.name).replace(/\.yaml$/, '')}.md`;
      const adrUri = vscode.Uri.joinPath(adrDir, adrName);
      const markdown = renderAdr({ number: next, plan, base, assessment });
      await vscode.workspace.fs.writeFile(adrUri, new TextEncoder().encode(markdown));

      const decided: Plan = { ...plan, status: 'decided' };
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(serializePlan(decided)));

      const path = `docs/adr/${adrName}`;
      this.deps.logger.info(`Decision record written: ${path}.`);
      this.post({ type: 'plan:adrSaved', file: target.path.split('/').pop()!, path });
      await this.pushPlanEntries();
    } catch (error) {
      this.deps.logger.error(`ADR generation failed: ${String(error)}`);
      this.post({ type: 'model:error', message: 'Atlas could not write the decision record.' });
    }
  }

  /**
   * Derive the map from the code's import graph — instant, deterministic, no AI.
   * Re-running it keeps the map current while preserving names, layout, and
   * bindings (see mergeExtraction), so the map stays in sync with the code.
   */
  private async runMapFromCode(): Promise<void> {
    const root =
      vscode.workspace.getConfiguration('atlas').get<string>('sourceRoot')?.trim() || 'src';
    this.post({ type: 'ai:status', busy: true, job: 'detect', label: 'Mapping from code…' });
    try {
      const pattern = new vscode.RelativePattern(this.deps.workspaceFolder, `${root}/**/*.{ts,tsx,js,jsx,mjs,cjs}`);
      const uris = await vscode.workspace.findFiles(
        pattern,
        '**/{node_modules,dist,dist-test,out,build,coverage}/**',
      );
      const files = await Promise.all(
        uris
          .filter((uri) => !/\.d\.ts$|\.(test|spec)\./.test(uri.fsPath))
          .map(async (uri) => ({
            path: relativePosix(this.deps.cwd, uri.fsPath),
            content: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
          })),
      );
      if (files.length === 0) {
        void vscode.window.showWarningMessage(
          `Atlas found no source files under "${root}/". Set "atlas.sourceRoot" to your code's root.`,
        );
        return;
      }
      const extracted = extractArchitecture(files, { sourceRoot: root, depth: 2 });
      const { model: current } = await this.deps.fileService.read();
      const merged = mergeExtraction(current, extracted);
      await this.deps.fileService.write(merged);
      await this.deps.baseline.set(merged);
      await this.deps.baseline.setCommit(await getHeadCommit(this.deps.cwd));
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

  /**
   * Repo changed: always refresh drift (cheap git query, no AI). Only auto
   * re-detect when the user opted in and it's safe — never clobber pending
   * manual edits still sitting in the webview's debounce.
   */
  private async onRepoChanged(): Promise<void> {
    const { model } = await this.deps.fileService.read();
    await this.pushDriftStatus(model);
    await this.pushRulesConfig();

    const autoSync = vscode.workspace.getConfiguration('atlas').get<boolean>('autoSync', false);
    if (!autoSync || this.busy) {
      return;
    }
    if (Date.now() - this.lastWebviewEditAt < 4000) {
      return;
    }
    const base = this.deps.baseline.get() ?? model;
    if (!isEmptyDelta(diffModels(base, model))) {
      return;
    }
    await this.runDetect('Syncing from code…');
  }

  private async pushDriftStatus(model: ArchitectureModel): Promise<void> {
    const drifted = await computeDrift(this.deps.cwd, model, this.deps.baseline.getCommit());
    this.post({ type: 'drift:status', driftedNodeIds: drifted });
  }

  private async pushRulesConfig(): Promise<void> {
    const uri = vscode.Uri.joinPath(this.deps.workspaceFolder.uri, 'atlas.rules.yaml');
    let text = '';
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
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
      const { agent, label: engine } = await this.deps.resolveAgent();
      this.post({ type: 'ai:status', busy: true, job: 'chat', label: `Thinking… · ${engine}` });
      const { model } = await this.deps.fileService.read();
      const response = await agent.chat(
        this.deps.cwd,
        model,
        history,
        message,
        (text) => this.post({ type: 'chat:token', text }),
        this.abortController!,
      );
      let proposal: ChangeProposal | undefined;
      if (response.proposal && response.proposal.nodes?.length) {
        const target = detectedToModel(
          { nodes: response.proposal.nodes, edges: response.proposal.edges },
          { preservePositionsFrom: model },
        );
        // The proposal is model-authored, untrusted content. Only surface it if
        // it forms a valid graph; otherwise keep the prose and drop the proposal.
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
      this.post({
        type: 'model:error',
        message: 'Cannot apply an invalid architecture.',
        issues: validation.issues,
      });
      return;
    }
    if (!this.begin('codegen', 'Generating code…')) {
      return;
    }
    try {
      // Reflect the target on the canvas + file before generating code.
      await this.deps.fileService.write(target);
      this.post({ type: 'model:loaded', model: target });

      const base = this.deps.baseline.get() ?? createEmptyModel();
      const delta = diffModels(base, target);
      if (isEmptyDelta(delta)) {
        await this.deps.baseline.set(target);
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

      const { agent, label: engine } = await this.deps.resolveAgent();
      this.post({ type: 'ai:status', busy: true, job: 'codegen', label: `Generating code… · ${engine}` });
      this.deps.logger.info(
        `Code generation started for ${summarizeDelta(delta).length} change(s) via ${engine}.`,
      );
      const result = await agent.generateCode(
        this.deps.cwd,
        delta,
        target,
        instruction,
        (event) => this.relay('codegen', event),
        this.abortController!,
      );
      const diff = await getWorkingTreeDiff(this.deps.cwd, result.touchedFiles);
      this.lastApply = { baseline: base, files: result.touchedFiles };

      // Close the loop: only advance the baseline if the code is verified to
      // realize the change. Otherwise it stays pending and the report explains.
      const verifyCommand = vscode.workspace
        .getConfiguration('atlas')
        .get<string>('verifyCommand');
      const verification = await verifyCodegen(this.deps.cwd, delta, target, {
        command: verifyCommand,
        trusted: vscode.workspace.isTrusted,
        touchedFiles: result.touchedFiles,
      });
      this.deps.logger.info(
        `Code generation complete: ${result.touchedFiles.length} file(s) touched, verification ${verification.ok ? 'PASSED' : 'FAILED'}.`,
      );
      if (verification.ok) {
        await this.deps.baseline.set(target);
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

  /** Revert the files from the last apply and re-surface those changes as pending. */
  private async runRevert(): Promise<void> {
    if (this.busy) {
      this.post({ type: 'apply:reverted', ok: false });
      return;
    }
    if (!this.lastApply) {
      this.post({ type: 'apply:reverted', ok: false });
      return;
    }
    const { baseline, files } = this.lastApply;
    this.lastApply = undefined;
    try {
      await revertFiles(this.deps.cwd, files);
      // The code no longer reflects the applied model, so roll the baseline back —
      // the change shows up as pending again.
      await this.deps.baseline.set(baseline);
      const { model } = await this.deps.fileService.read();
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
      this.post({
        type: 'model:error',
        message: 'Changes were not saved because the model is invalid.',
        issues: result.issues,
      });
      return;
    }
    try {
      await this.deps.fileService.write(model);
    } catch (error) {
      this.deps.logger.error(`Failed to save atlas.yaml: ${String(error)}`);
      this.post({
        type: 'model:error',
        message: 'Atlas could not save your changes to disk.',
      });
    }
  }

  private async pushModelToWebview(force = false): Promise<void> {
    // A `model:loaded` push replaces the webview's model and clears its undo
    // history. If the user has an edit still in flight (debounced in the webview,
    // not yet persisted), an externally-triggered reload would discard it. Defer
    // to the live edit unless this is an explicit (re)mount load.
    if (!force && Date.now() - this.lastWebviewEditAt < 2000) {
      this.deps.logger.info('Skipped an external reload to preserve an in-flight edit.');
      return;
    }
    const { model, error, readOnly } = await this.deps.fileService.read();
    if (error) {
      this.post({ type: 'model:error', message: error });
      return;
    }
    if (readOnly) {
      this.post({
        type: 'model:error',
        message:
          'This atlas.yaml was written by a newer version of Atlas. It is read-only until you update the extension.',
      });
    }
    // First open of an existing map assumes the code already matches it.
    if (!this.deps.baseline.get()) {
      await this.deps.baseline.set(model);
    }
    if (!this.deps.baseline.getCommit()) {
      await this.deps.baseline.setCommit(await getHeadCommit(this.deps.cwd));
    }
    this.post({ type: 'model:loaded', model });
    await this.pushSyncStatus(model);
    await this.pushDriftStatus(model);
    await this.pushRulesConfig();
  }

  private async pushSyncStatus(model: ArchitectureModel): Promise<void> {
    // No baseline → diff against the empty model, so everything reads as pending
    // (the honest state) rather than diffing the model against itself, which
    // would always claim "in sync".
    const base = this.deps.baseline.get() ?? createEmptyModel();
    const delta = diffModels(base, model);
    this.post({ type: 'sync:status', pendingSummary: summarizeDelta(delta) });
  }

  private relay(job: AiJob, event: AgentEvent): void {
    const line =
      event.kind === 'tool'
        ? `${event.name}${event.detail ? ` ${event.detail}` : ''}`
        : event.text;
    if (line.trim()) {
      this.post({ type: 'ai:progress', job, line: line.trim() });
    }
  }

  private begin(job: AiJob, label: string): boolean {
    if (this.busy) {
      this.post({
        type: 'ai:error',
        code: 'failed',
        message: 'An AI task is already running.',
      });
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
        message:
          'Claude CLI not found. Install Claude Code, set "atlas.claudeExecutablePath", or set an API key.',
      });
      return;
    }
    this.post({ type: 'ai:error', code: 'failed', message });
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    ArchitecturePanel.current = undefined;
    this.abortController?.abort();
    void this.mcpBridge?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.panel.dispose();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** POSIX repo-relative path for an absolute fs path, for the extractor. */
function relativePosix(root: string, fsPath: string): string {
  return relative(root, fsPath).replace(/\\/g, '/');
}
