/**
 * The `Atlas: Open Architecture` command.
 *
 * Assembles the panel's collaborators — file service, AI agent, baseline store —
 * and reveals the architecture canvas. Wiring lives here so each command stays a
 * small, declarative composition of services.
 */

import * as vscode from 'vscode';

import { AuthProvider } from '../ai/AuthProvider';
import { ClaudeAgent } from '../ai/ClaudeAgent';
import { ArchitecturePanel } from '../panel/ArchitecturePanel';
import { AtlasFileService } from '../workspace/AtlasFileService';
import { BaselineStore } from '../workspace/BaselineStore';

export const OPEN_ARCHITECTURE_COMMAND = 'atlas.openArchitecture';

/** Open (or focus) the architecture panel for the first workspace folder. */
export function openArchitecture(context: vscode.ExtensionContext): boolean {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage(
      'Atlas needs an open workspace folder to store atlas.yaml.',
    );
    return false;
  }

  const auth = new AuthProvider(context.secrets);
  ArchitecturePanel.createOrShow({
    extensionUri: context.extensionUri,
    fileService: new AtlasFileService(workspaceFolder),
    agent: new ClaudeAgent(auth),
    baseline: new BaselineStore(context.workspaceState, workspaceFolder),
    workspaceFolder,
    cwd: workspaceFolder.uri.fsPath,
  });
  return true;
}

export function registerOpenArchitectureCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand(OPEN_ARCHITECTURE_COMMAND, () =>
    openArchitecture(context),
  );
}
