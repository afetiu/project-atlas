/**
 * `Atlas: Export Architecture` — render the current model as Mermaid or Markdown
 * and open it in a new editor, for pasting into docs, PRs, or wikis.
 */

import * as vscode from 'vscode';

import {
  toArchitectureDoc,
  toMermaid,
  toSvg,
  updateReadmeBlock,
  type SvgTheme,
} from '../../shared/export/diagram';
import { applyLayout, deserializeModel } from '../../shared/serialization/yaml';
import { ATLAS_LAYOUT_FILE_NAME } from '../workspace/AtlasFileService';

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

    // Merge in saved canvas positions so the SVG matches what the user laid out.
    try {
      const layoutUri = vscode.Uri.joinPath(workspaceFolder.uri, ATLAS_LAYOUT_FILE_NAME);
      const layoutBytes = await vscode.workspace.fs.readFile(layoutUri);
      model = applyLayout(model, new TextDecoder().decode(layoutBytes));
    } catch {
      // No sidecar — toSvg falls back to auto-layout.
    }

    const format = await vscode.window.showQuickPick(
      [
        { label: 'Architecture doc', detail: 'A full Markdown doc: diagram, health, component catalog, findings' },
        { label: 'Mermaid', detail: 'A flowchart diagram for Markdown/docs' },
        { label: 'SVG (light)', detail: 'A vector image for a light background' },
        { label: 'SVG (dark)', detail: 'A vector image for a dark background' },
        { label: 'Update README diagram', detail: 'Insert/refresh the Atlas block in README.md' },
      ],
      { title: 'Export architecture as…' },
    );
    if (!format) {
      return;
    }

    if (format.label.startsWith('SVG')) {
      const theme: SvgTheme = format.label.includes('dark') ? 'dark' : 'light';
      const target = await vscode.window.showSaveDialog({
        title: `Export architecture as SVG (${theme})`,
        defaultUri: vscode.Uri.joinPath(workspaceFolder.uri, `architecture${theme === 'dark' ? '.dark' : ''}.svg`),
        filters: { 'SVG image': ['svg'] },
      });
      if (!target) {
        return;
      }
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(toSvg(model, theme)));
      const open = await vscode.window.showInformationMessage('Architecture exported to SVG.', 'Open');
      if (open === 'Open') {
        await vscode.commands.executeCommand('vscode.open', target);
      }
      return;
    }

    if (format.label === 'Update README diagram') {
      const readmeUri = vscode.Uri.joinPath(workspaceFolder.uri, 'README.md');
      let existing = '';
      try {
        existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(readmeUri));
      } catch {
        existing = ''; // no README yet — one will be created with the block
      }
      const updated = updateReadmeBlock(existing, model);
      await vscode.workspace.fs.writeFile(readmeUri, new TextEncoder().encode(updated));
      const open = await vscode.window.showInformationMessage(
        existing ? 'Updated the Atlas diagram block in README.md.' : 'Created README.md with the architecture diagram.',
        'Open',
      );
      if (open === 'Open') {
        await vscode.commands.executeCommand('vscode.open', readmeUri);
      }
      return;
    }

    const isDoc = format.label === 'Architecture doc';
    const document = await vscode.workspace.openTextDocument({
      language: isDoc ? 'markdown' : 'mermaid',
      content: isDoc ? toArchitectureDoc(model) : toMermaid(model),
    });
    await vscode.window.showTextDocument(document);
  });
}
