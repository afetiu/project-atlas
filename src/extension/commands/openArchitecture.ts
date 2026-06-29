/**
 * The `Atlas: Open Architecture` command.
 *
 * Resolves the active workspace folder, wires up the file service, and reveals
 * the architecture canvas. Command registration is kept here so that adding new
 * commands later is a matter of dropping a sibling file in this folder.
 */

import * as vscode from 'vscode';

import { ArchitecturePanel } from '../panel/ArchitecturePanel';
import { AtlasFileService } from '../workspace/AtlasFileService';

export const OPEN_ARCHITECTURE_COMMAND = 'atlas.openArchitecture';

export function registerOpenArchitectureCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand(OPEN_ARCHITECTURE_COMMAND, () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      void vscode.window.showErrorMessage(
        'Atlas needs an open workspace folder to store atlas.yaml.',
      );
      return;
    }

    // The file service lives for the duration of the panel, which takes
    // ownership and disposes it when closed.
    const fileService = new AtlasFileService(workspaceFolder);
    ArchitecturePanel.createOrShow(context.extensionUri, fileService);
  });
}
