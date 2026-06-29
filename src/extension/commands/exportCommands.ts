/**
 * `Atlas: Export Architecture` — render the current model as Mermaid or Markdown
 * and open it in a new editor, for pasting into docs, PRs, or wikis.
 */

import * as vscode from 'vscode';

import { toMarkdown, toMermaid } from '../../shared/export/diagram';
import { deserializeModel } from '../../shared/serialization/yaml';

export const EXPORT_COMMAND = 'atlas.export';

export function registerExportCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(EXPORT_COMMAND, async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      void vscode.window.showErrorMessage('Atlas needs an open workspace folder.');
      return;
    }

    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, 'atlas.yaml');
    let model;
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      model = deserializeModel(new TextDecoder().decode(bytes));
    } catch {
      void vscode.window.showErrorMessage('No atlas.yaml to export. Open or detect an architecture first.');
      return;
    }

    const format = await vscode.window.showQuickPick(
      [
        { label: 'Mermaid', detail: 'A flowchart diagram for Markdown/docs' },
        { label: 'Markdown', detail: 'A full document with diagram and component table' },
      ],
      { title: 'Export architecture as…' },
    );
    if (!format) {
      return;
    }

    const isMarkdown = format.label === 'Markdown';
    const document = await vscode.workspace.openTextDocument({
      language: isMarkdown ? 'markdown' : 'mermaid',
      content: isMarkdown ? toMarkdown(model) : toMermaid(model),
    });
    await vscode.window.showTextDocument(document);
  });
}
