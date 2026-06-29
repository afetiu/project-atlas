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
import { AiError, ClaudeAgent, type AgentEvent } from '../ai/ClaudeAgent';
import { BaselineStore } from '../workspace/BaselineStore';
import { AtlasFileService } from '../workspace/AtlasFileService';
import { RepoWatcher } from '../workspace/RepoWatcher';
import { getWorkingTreeDiff, revertFiles } from '../workspace/git';
import { buildWebviewHtml } from './webviewHtml';

export interface PanelDependencies {
  extensionUri: vscode.Uri;
  fileService: AtlasFileService;
  agent: ClaudeAgent;
  baseline: BaselineStore;
  workspaceFolder: vscode.WorkspaceFolder;
  cwd: string;
}

export class ArchitecturePanel {
  public static readonly viewType = 'atlas.architecture';
  private static current: ArchitecturePanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private abortController: AbortController | undefined;
  private busy = false;
  /** State needed to revert the most recent code generation. */
  private lastApply: { baseline: ArchitectureModel; files: string[] } | undefined;

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
    switch (message.type) {
      case 'webview:ready':
        await this.pushModelToWebview();
        break;
      case 'model:changed':
        await this.persistModel(message.model);
        await this.pushSyncStatus(message.model);
        break;
      case 'ai:detect':
        await this.runDetect();
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
        await this.openMappedPath(message.path);
        break;
    }
  }

  /** Open a mapped file, or reveal it in the Explorer if it's a directory. */
  private async openMappedPath(relativePath: string): Promise<void> {
    const uri = vscode.Uri.joinPath(this.deps.workspaceFolder.uri, relativePath);
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
      // Preserve the current layout so re-running detection doesn't reshuffle
      // the canvas — only the architecture content is refreshed.
      const { model: previous } = await this.deps.fileService.read();
      const model = await this.deps.agent.detect(
        this.deps.cwd,
        (event) => this.relay('detect', event),
        this.abortController!,
        previous,
      );
      await this.deps.fileService.write(model);
      await this.deps.baseline.set(model);
      this.post({ type: 'model:loaded', model });
      await this.pushSyncStatus(model);
    } catch (error) {
      this.reportAiError(error);
    } finally {
      this.end();
    }
  }

  /**
   * Auto-sync hook: re-detect when the repo changes, but never clobber pending
   * manual edits — if the canvas is ahead of the baseline, the user is mid-edit
   * and we leave their work alone.
   */
  private async onRepoChanged(): Promise<void> {
    if (this.busy) {
      return;
    }
    const { model } = await this.deps.fileService.read();
    const base = this.deps.baseline.get() ?? model;
    if (!isEmptyDelta(diffModels(base, model))) {
      return;
    }
    await this.runDetect('Syncing from code…');
  }

  private async runChat(message: string, history: ChatTurn[]): Promise<void> {
    if (!this.begin('chat', 'Thinking…')) {
      return;
    }
    try {
      const { model } = await this.deps.fileService.read();
      const response = await this.deps.agent.chat(
        this.deps.cwd,
        model,
        history,
        message,
        (event) => this.relay('chat', event),
        this.abortController!,
      );
      let proposal: ChangeProposal | undefined;
      if (response.proposal && response.proposal.nodes?.length) {
        const target = detectedToModel(
          { nodes: response.proposal.nodes, edges: response.proposal.edges },
          { preservePositionsFrom: model },
        );
        proposal = { summary: response.proposal.summary, model: target };
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
        });
        await this.pushSyncStatus(target);
        return;
      }

      const result = await this.deps.agent.generateCode(
        this.deps.cwd,
        delta,
        target,
        instruction,
        (event) => this.relay('codegen', event),
        this.abortController!,
      );
      const diff = await getWorkingTreeDiff(this.deps.cwd);
      this.lastApply = { baseline: base, files: result.touchedFiles };
      await this.deps.baseline.set(target);
      this.post({
        type: 'apply:done',
        summary: result.summary,
        diff,
        revertable: result.touchedFiles.length > 0,
      });
      await this.pushSyncStatus(target);
    } catch (error) {
      this.reportAiError(error);
    } finally {
      this.end();
    }
  }

  /** Revert the files from the last apply and re-surface those changes as pending. */
  private async runRevert(): Promise<void> {
    if (!this.lastApply || this.busy) {
      return;
    }
    const { baseline, files } = this.lastApply;
    this.lastApply = undefined;
    await revertFiles(this.deps.cwd, files);
    // The code no longer reflects the applied model, so roll the baseline back —
    // the change shows up as pending again.
    await this.deps.baseline.set(baseline);
    const { model } = await this.deps.fileService.read();
    await this.pushSyncStatus(model);
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
    await this.deps.fileService.write(model);
  }

  private async pushModelToWebview(): Promise<void> {
    const { model, error } = await this.deps.fileService.read();
    if (error) {
      this.post({ type: 'model:error', message: error });
      return;
    }
    // First open of an existing map assumes the code already matches it.
    if (!this.deps.baseline.get()) {
      await this.deps.baseline.set(model);
    }
    this.post({ type: 'model:loaded', model });
    await this.pushSyncStatus(model);
  }

  private async pushSyncStatus(model: ArchitectureModel): Promise<void> {
    const base = this.deps.baseline.get() ?? model;
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
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.panel.dispose();
  }
}
