/**
 * `Atlas: Register MCP Server` — wires Atlas's MCP server into the workspace's
 * `.mcp.json`, so the user's Claude Code can read and edit the live
 * architecture map through tools.
 *
 * The server itself is a standalone bundle (`dist/mcp-server.mjs`) that Claude
 * Code launches on demand; it mutates `atlas.yaml`, and Atlas's file watcher
 * reflects those edits on the canvas automatically.
 */

import * as vscode from 'vscode';

export const REGISTER_MCP_COMMAND = 'atlas.registerMcpServer';

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

export function registerMcpCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand(REGISTER_MCP_COMMAND, async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      void vscode.window.showErrorMessage('Atlas needs an open workspace folder.');
      return;
    }

    const serverPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp-server.mjs').fsPath;
    const configUri = vscode.Uri.joinPath(workspaceFolder.uri, '.mcp.json');

    const config = await readJson(configUri);
    config.mcpServers = {
      ...(config.mcpServers ?? {}),
      atlas: {
        command: 'node',
        args: [serverPath],
        env: { ATLAS_WORKSPACE: workspaceFolder.uri.fsPath },
      },
    };

    await vscode.workspace.fs.writeFile(
      configUri,
      new TextEncoder().encode(`${JSON.stringify(config, null, 2)}\n`),
    );
    void vscode.window.showInformationMessage(
      'Atlas MCP server registered in .mcp.json. Restart Claude Code to load it.',
    );
  });
}

async function readJson(uri: vscode.Uri): Promise<McpConfig> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === 'object' ? (parsed as McpConfig) : {};
  } catch {
    return {};
  }
}
