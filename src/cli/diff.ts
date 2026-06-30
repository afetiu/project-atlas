/**
 * `atlas diff` — compare two `atlas.yaml` versions and emit a Markdown summary
 * of the architecture changes, suitable for posting as a pull-request comment.
 *
 *   node dist/atlas-diff.mjs <base.yaml> <head.yaml>
 *
 * The base file may be missing (a brand-new architecture); the head file is
 * required. Output begins with a stable marker comment so a CI job can update
 * one sticky comment instead of posting a new one each push.
 */

import { existsSync, readFileSync } from 'fs';

import { analyzeArchitecture } from '../shared/model/insights';
import { diffModels, summarizeDelta } from '../shared/model/diff';
import { createEmptyModel, type ArchitectureModel } from '../shared/model/types';
import { deserializeModel } from '../shared/serialization/yaml';

export const PR_COMMENT_MARKER = '<!-- atlas-pr-comment -->';

function load(path: string | undefined): ArchitectureModel {
  if (!path || !existsSync(path)) {
    return createEmptyModel();
  }
  return deserializeModel(readFileSync(path, 'utf8'));
}

/** Build the Markdown body for a PR comment from a base/head model pair. */
export function renderPrComment(base: ArchitectureModel, head: ArchitectureModel): string {
  const delta = diffModels(base, head);
  const lines = summarizeDelta(delta);
  const baseReport = analyzeArchitecture(base);
  const headReport = analyzeArchitecture(head);

  const out: string[] = [PR_COMMENT_MARKER, '## 🗺 Architecture changes', ''];

  if (lines.length === 0) {
    out.push('No architecture changes in this PR.');
  } else {
    // Bucket the human-readable lines by their leading verb for a tidy list.
    const bucket = (re: RegExp) => lines.filter((l) => re.test(l));
    const added = bucket(/^(Add|Connect)/);
    const removed = bucket(/^(Remove|Disconnect)/);
    const changed = lines.filter((l) => !added.includes(l) && !removed.includes(l));
    const section = (title: string, items: string[], mark: string) => {
      if (items.length === 0) return;
      out.push(`**${title}**`);
      for (const item of items) out.push(`- ${mark} ${item}`);
      out.push('');
    };
    section('Added', added, '🟢');
    section('Removed', removed, '🔴');
    section('Changed', changed, '🟡');
  }

  // Health delta — only show when meaningful.
  if (head.nodes.length > 0) {
    const arrow = headReport.score === baseReport.score ? '' : ` (was ${baseReport.grade} ${baseReport.score})`;
    out.push('', `**Health:** ${headReport.grade} ${headReport.score}/100${arrow}`);
    const critical = headReport.insights.filter((i) => i.severity === 'critical');
    if (critical.length > 0) {
      out.push('', '⚠️ Critical findings:');
      for (const i of critical) out.push(`- ${i.detail}`);
    }
  }

  return out.join('\n');
}

function main(): void {
  const [basePath, headPath] = process.argv.slice(2);
  if (!headPath) {
    console.error('usage: atlas diff <base.yaml> <head.yaml>');
    process.exit(2);
  }
  let base: ArchitectureModel;
  let head: ArchitectureModel;
  try {
    base = load(basePath);
    head = load(headPath);
  } catch (error) {
    console.error(`atlas diff: ${(error as Error).message}`);
    process.exit(2);
  }
  console.log(renderPrComment(base, head));
}

// Only run as a CLI when invoked directly (not when imported by a test).
if (/atlas-diff|cli[\\/]diff/.test(process.argv[1] ?? '')) {
  main();
}
