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
import { Logger } from './log';

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  context.subscriptions.push(
    logger,
    registerOpenArchitectureCommand(context, logger),
    registerMcpCommand(context),
    registerExportCommand(),
    ...registerAiCommands(context, logger),
  );
}

export function deactivate(): void {
  // Resources are tied to `context.subscriptions` and panel lifecycles, so
  // there is nothing to tear down explicitly here.
}
