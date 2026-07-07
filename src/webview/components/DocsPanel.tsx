/**
 * The Docs panel: the workspace's Markdown documentation, catalogued — grouped
 * by where it lives, searchable, linked to the architecture components it
 * documents. Selecting a doc opens the reader overlay.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { groupDocs, type DocMeta } from '../../shared/docs/catalog';
import type { ArchitectureModel } from '../../shared/model/types';
import type { DocsState } from '../model/useDocs';

interface DocsPanelProps {
  docs: DocsState;
  model: ArchitectureModel;
  onFocusNode: (id: string) => void;
}

export function DocsPanel({ docs, model, onFocusNode }: DocsPanelProps): JSX.Element {
  const [query, setQuery] = useState('');

  // Scan lazily the first time the panel is shown (mount-only by design).
  const scanRequested = useRef(false);
  useEffect(() => {
    if (!scanRequested.current && !docs.scanned && !docs.scanning) {
      scanRequested.current = true;
      docs.scan();
    }
  }, [docs]);

  const nameOf = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? docs.docs.filter(
          (d) =>
            d.title.toLowerCase().includes(q) ||
            d.path.toLowerCase().includes(q) ||
            d.excerpt.toLowerCase().includes(q),
        )
      : docs.docs;
    return groupDocs(filtered);
  }, [docs.docs, query]);

  if (docs.scanning && !docs.scanned) {
    return (
      <div className="atlas-inspector__empty">
        <div className="atlas-inspector__empty-title">Scanning documentation…</div>
      </div>
    );
  }

  if (docs.scanned && docs.docs.length === 0) {
    return (
      <div className="atlas-inspector__empty">
        <div className="atlas-inspector__empty-title">No Markdown docs found</div>
        <p className="atlas-inspector__empty-body">
          Add .md files to the repository and they will be catalogued here.
        </p>
      </div>
    );
  }

  return (
    <div className="atlas-docs">
      <div className="atlas-docs__search">
        <input
          className="atlas-input"
          type="text"
          placeholder={`Search ${docs.docs.length} document${docs.docs.length === 1 ? '' : 's'}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="atlas-docs__sections">
        {sections.map((section) => (
          <div key={section.name} className="atlas-docs__section">
            <div className="atlas-docs__section-name">{section.name}</div>
            {section.docs.map((doc) => (
              <DocRow key={doc.path} doc={doc} nameOf={nameOf} onOpen={docs.openDoc} onFocusNode={onFocusNode} />
            ))}
          </div>
        ))}
        {sections.length === 0 && <div className="atlas-docs__none">No matches.</div>}
      </div>
    </div>
  );
}

function DocRow({
  doc,
  nameOf,
  onOpen,
  onFocusNode,
}: {
  doc: DocMeta;
  nameOf: (id: string) => string;
  onOpen: (path: string) => void;
  onFocusNode: (id: string) => void;
}): JSX.Element {
  return (
    <div className="atlas-doc">
      <button type="button" className="atlas-doc__main" onClick={() => onOpen(doc.path)}>
        <span className="atlas-doc__title">{doc.title}</span>
        {doc.excerpt && <span className="atlas-doc__excerpt">{doc.excerpt}</span>}
        <span className="atlas-doc__path">{doc.path}</span>
      </button>
      {doc.componentId && (
        <button
          type="button"
          className="atlas-doc__component"
          title="Show this component on the map"
          onClick={() => onFocusNode(doc.componentId!)}
        >
          ⌖ {nameOf(doc.componentId)}
        </button>
      )}
    </div>
  );
}
