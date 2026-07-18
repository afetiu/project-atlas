/**
 * `Atlas: Register MCP Server` — wires Atlas's MCP server into the config of
 * whichever MCP clients the user picks (Claude Code, Cursor, Windsurf, Gemini
 * CLI, Codex CLI), so their existing agent can read and edit the live
 * architecture map through tools.
 *
 * The server itself is a standalone bundle (`dist/mcp-server.mjs`) that the
 * client launches on demand; it mutates `atlas.yaml`, and Atlas's file watcher
 * reflects those edits on the canvas automatically.
 */

import { homedir } from 'os';
import { dirname } from 'path';

import * as vscode from 'vscode';

import { mcpClientTargets, type McpClientTarget, type McpServerSpec } from '../mcp/clientConfigs';

export const REGISTER_MCP_COMMAND = 'atlas.registerMcpServer';

export function registerMcpCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand(REGISTER_MCP_COMMAND, async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      void vscode.window.showErrorMessage('Atlas needs an open workspace folder.');
      return;
    }

    const spec: McpServerSpec = {
      serverPath: vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp-server.mjs').fsPath,
      workspacePath: workspaceFolder.uri.fsPath,
    };
    const targets = mcpClientTargets(spec.workspacePath, homedir());

    const picked = await vscode.window.showQuickPick(
      targets.map((target) => ({
        target,
        label: target.label,
        description: target.global ? `${target.configPath} (global)` : target.configPath,
        picked: target.id === 'claude-code' || target.id === 'cursor',
      })),
      {
        title: 'Atlas — Register MCP Server',
        placeHolder: 'Which agents should be able to read and edit the architecture map?',
        canPickMany: true,
        ignoreFocusOut: true,
      },
    );
    if (!picked || picked.length === 0) {
      return;
    }

    const done: string[] = [];
    const failed: string[] = [];
    for (const { target } of picked) {
      try {
        await registerFor(target, spec);
        done.push(target.label);
      } catch (error) {
        failed.push(`${target.label} (${error instanceof Error ? error.message : String(error)})`);
      }
    }

    if (done.length > 0) {
      const notes = picked
        .filter(({ target }) => done.includes(target.label))
        .map(({ target }) => `${target.label}: ${target.note}`)
        .join(' ');
      void vscode.window.showInformationMessage(
        `Atlas MCP server registered for ${done.join(', ')}. ${notes}`,
      );
    }
    if (failed.length > 0) {
      void vscode.window.showErrorMessage(`Atlas could not register: ${failed.join('; ')}`);
    }
  });
}

async function registerFor(target: McpClientTarget, spec: McpServerSpec): Promise<void> {
  const uri = vscode.Uri.file(target.configPath);
  let existing = '';
  try {
    existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    existing = ''; // file doesn't exist yet
  }
  const updated = target.apply(existing, spec);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(target.configPath)));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
}
