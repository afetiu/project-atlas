/**
 * The docs catalog: turns a flat list of Markdown files into the structured,
 * grouped view the Docs panel shows — sectioned by where docs live, and linked
 * to the architecture component whose code they document (matched by the
 * component's code mapping path).
 */

import type { ArchitectureModel } from '../model/types';
import type { DocHeading } from './markdown';

export interface DocMeta {
  /** Workspace-relative POSIX path. */
  path: string;
  title: string;
  excerpt: string;
  headings: DocHeading[];
  /** Architecture component this doc belongs to, when it lives under one. */
  componentId?: string;
}

export interface DocSection {
  /** Display name — a directory, or "Overview" for repo-root docs. */
  name: string;
  docs: DocMeta[];
}

/** Link each doc to the component whose mapping path contains it (deepest wins). */
export function matchDocsToComponents(docs: DocMeta[], model: ArchitectureModel): DocMeta[] {
  const mapped = model.nodes
    .filter((n) => !!n.mapping?.path)
    .map((n) => ({ id: n.id, path: n.mapping!.path!.replace(/\\/g, '/').replace(/\/+$/, '') }))
    .sort((a, b) => b.path.length - a.path.length); // deepest mapping first

  return docs.map((doc) => {
    const owner = mapped.find((m) => doc.path === m.path || doc.path.startsWith(`${m.path}/`));
    return owner ? { ...doc, componentId: owner.id } : doc;
  });
}

/** Group docs into sections by their top-level directory; root docs first. */
export function groupDocs(docs: DocMeta[]): DocSection[] {
  const sections = new Map<string, DocMeta[]>();
  for (const doc of docs) {
    const slash = doc.path.indexOf('/');
    const key = slash === -1 ? '' : doc.path.slice(0, slash);
    (sections.get(key) ?? sections.set(key, []).get(key)!).push(doc);
  }
  const ordered = [...sections.entries()].sort(([a], [b]) => {
    if (a === '') return -1; // repo root ("Overview") leads
    if (b === '') return 1;
    if (a === 'docs') return -1; // then the docs/ directory
    if (b === 'docs') return 1;
    return a.localeCompare(b);
  });
  return ordered.map(([key, list]) => ({
    name: key === '' ? 'Overview' : key,
    docs: [...list].sort((a, b) => a.path.localeCompare(b.path)),
  }));
}
