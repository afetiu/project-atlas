/**
 * AI-related commands: detection and API-key management.
 *
 * Detection is also reachable from the canvas, but a command makes it
 * discoverable in the Command Palette. Key management stores the secret in
 * VS Code SecretStorage via {@link AuthProvider}.
 */

import * as vscode from 'vscode';

import { AuthProvider } from '../ai/AuthProvider';
import { ArchitecturePanel } from '../panel/ArchitecturePanel';
import { openArchitecture } from './openArchitecture';

export const DETECT_COMMAND = 'atlas.detectArchitecture';
export const SET_API_KEY_COMMAND = 'atlas.setApiKey';
export const CLEAR_API_KEY_COMMAND = 'atlas.clearApiKey';

export function registerAiCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  const auth = new AuthProvider(context.secrets);

  return [
    vscode.commands.registerCommand(DETECT_COMMAND, () => {
      // Ensure the panel exists, then ask it to detect.
      if (openArchitecture(context)) {
        ArchitecturePanel.detect();
      }
    }),

    vscode.commands.registerCommand(SET_API_KEY_COMMAND, async () => {
      const key = await vscode.window.showInputBox({
        title: 'Atlas — Anthropic API Key',
        prompt: 'Stored securely in VS Code. Leave empty to use your Claude Code login.',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'sk-ant-…',
      });
      if (key === undefined) {
        return;
      }
      if (key.trim().length === 0) {
        await auth.clearApiKey();
        void vscode.window.showInformationMessage('Atlas will use your Claude Code login.');
        return;
      }
      await auth.setApiKey(key);
      void vscode.window.showInformationMessage('Atlas API key saved.');
    }),

    vscode.commands.registerCommand(CLEAR_API_KEY_COMMAND, async () => {
      await auth.clearApiKey();
      void vscode.window.showInformationMessage('Atlas API key cleared.');
    }),
  ];
}
