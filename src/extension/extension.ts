/**
 * Atlas extension entry point.
 *
 * Activation is intentionally thin: it registers commands and nothing more.
 * All real behaviour lives in dedicated, single-responsibility modules so this
 * file stays a stable, readable manifest of what the extension exposes.
 */

import * as vscode from 'vscode';

import { registerAiCommands } from './commands/aiCommands';
import { registerExportCommand } from './commands/exportCommands';
import { registerMcpCommand } from './commands/mcpCommands';
import { registerOpenArchitectureCommand } from './commands/openArchitecture';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerOpenArchitectureCommand(context),
    registerMcpCommand(context),
    registerExportCommand(),
    ...registerAiCommands(context),
  );
}

export function deactivate(): void {
  // Resources are tied to `context.subscriptions` and panel lifecycles, so
  // there is nothing to tear down explicitly here.
}
