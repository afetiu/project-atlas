/**
 * AI-related commands: detection and API-key management.
 *
 * Detection is also reachable from the canvas, but a command makes it
 * discoverable in the Command Palette. Key management stores the secret in
 * VS Code SecretStorage via {@link AuthProvider}.
 */

import * as vscode from 'vscode';

import { AuthProvider, PROVIDER_LABELS, type AiProviderId } from '../ai/AuthProvider';
import type { Logger } from '../log';
import { ArchitecturePanel } from '../panel/ArchitecturePanel';
import { openArchitecture } from './openArchitecture';

export const DETECT_COMMAND = 'atlas.detectArchitecture';
export const SET_API_KEY_COMMAND = 'atlas.setApiKey';
export const CLEAR_API_KEY_COMMAND = 'atlas.clearApiKey';

const KEY_PLACEHOLDERS: Record<AiProviderId, string> = {
  anthropic: 'sk-ant-…',
  openai: 'sk-…',
  gemini: 'AIza…',
};

/** Ask which provider a key operation applies to. */
async function pickProvider(title: string): Promise<AiProviderId | undefined> {
  const picked = await vscode.window.showQuickPick(
    (Object.keys(PROVIDER_LABELS) as AiProviderId[]).map((id) => ({
      id,
      label: PROVIDER_LABELS[id],
      description:
        id === 'anthropic' ? 'Optional if you are logged into Claude Code' : undefined,
    })),
    { title, ignoreFocusOut: true },
  );
  return picked?.id;
}

export function registerAiCommands(
  context: vscode.ExtensionContext,
  logger: Logger,
): vscode.Disposable[] {
  const auth = new AuthProvider(context.secrets);

  return [
    vscode.commands.registerCommand(DETECT_COMMAND, () => {
      // Ensure the panel exists, then ask it to detect.
      if (openArchitecture(context, logger)) {
        ArchitecturePanel.detect();
      }
    }),

    vscode.commands.registerCommand(SET_API_KEY_COMMAND, async () => {
      const provider = await pickProvider('Atlas — Set AI API Key');
      if (!provider) {
        return;
      }
      const key = await vscode.window.showInputBox({
        title: `Atlas — ${PROVIDER_LABELS[provider]} API Key`,
        prompt:
          provider === 'anthropic'
            ? 'Stored securely in VS Code. Leave empty to use your Claude Code login.'
            : 'Stored securely in VS Code. Leave empty to remove the stored key.',
        password: true,
        ignoreFocusOut: true,
        placeHolder: KEY_PLACEHOLDERS[provider],
      });
      if (key === undefined) {
        return;
      }
      if (key.trim().length === 0) {
        await auth.clearApiKey(provider);
        void vscode.window.showInformationMessage(
          provider === 'anthropic'
            ? 'Atlas will use your Claude Code login.'
            : `Atlas ${PROVIDER_LABELS[provider]} key removed.`,
        );
        return;
      }
      await auth.setApiKey(provider, key);
      void vscode.window.showInformationMessage(`Atlas ${PROVIDER_LABELS[provider]} key saved.`);
    }),

    vscode.commands.registerCommand(CLEAR_API_KEY_COMMAND, async () => {
      const provider = await pickProvider('Atlas — Clear AI API Key');
      if (!provider) {
        return;
      }
      await auth.clearApiKey(provider);
      void vscode.window.showInformationMessage(
        `Atlas ${PROVIDER_LABELS[provider]} key cleared.`,
      );
    }),
  ];
}
