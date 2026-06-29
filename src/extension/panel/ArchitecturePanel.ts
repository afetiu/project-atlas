/**
 * Manages the lifecycle of the Atlas architecture webview panel.
 *
 * This class is the bridge between the domain layer (`AtlasFileService`) and the
 * webview UI. It owns the single panel instance, translates messages in both
 * directions, and keeps the canvas and `atlas.yaml` in sync:
 *
 *   webview edit  → model:changed → AtlasFileService.write()
 *   external edit → onDidChangeExternally → read() → model:loaded → webview
 */

import * as vscode from 'vscode';

import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../../shared/messaging/protocol';
import type { ArchitectureModel } from '../../shared/model/types';
import { validateModel } from '../../shared/serialization/validation';
import { AtlasFileService } from '../workspace/AtlasFileService';
import { buildWebviewHtml } from './webviewHtml';

export class ArchitecturePanel {
  public static readonly viewType = 'atlas.architecture';
  private static current: ArchitecturePanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly fileService: AtlasFileService,
  ) {
    this.panel.webview.html = buildWebviewHtml(this.panel.webview, this.extensionUri);

    this.disposables.push(
      this.fileService,
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message)),
      this.fileService.onDidChangeExternally(() => this.pushModelToWebview()),
    );
  }

  /** Reveal the existing panel or create a new one. */
  static createOrShow(extensionUri: vscode.Uri, fileService: AtlasFileService): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ArchitecturePanel.current) {
      // A panel already owns its own file service; discard the redundant one.
      fileService.dispose();
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
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );

    ArchitecturePanel.current = new ArchitecturePanel(panel, extensionUri, fileService);
  }

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    switch (message.type) {
      case 'webview:ready':
        await this.pushModelToWebview();
        break;
      case 'model:changed':
        await this.persistModel(message.model);
        break;
    }
  }

  private async persistModel(model: ArchitectureModel): Promise<void> {
    const result = validateModel(model);
    if (!result.valid) {
      // Refuse to persist a structurally invalid model; surface the reason.
      this.post({
        type: 'model:error',
        message: 'Changes were not saved because the model is invalid.',
        issues: result.issues,
      });
      return;
    }
    await this.fileService.write(model);
  }

  private async pushModelToWebview(): Promise<void> {
    const { model, error } = await this.fileService.read();
    if (error) {
      this.post({ type: 'model:error', message: error });
      return;
    }
    this.post({ type: 'model:loaded', model });
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    ArchitecturePanel.current = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.panel.dispose();
  }
}
