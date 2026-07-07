/**
 * The document reader: a large sheet with a heading outline on the left and
 * beautifully-set Markdown on the right. Relative links to other docs navigate
 * in place; "Open in editor" jumps to the real file.
 */

import { useMemo, useRef } from 'react';

import type { DocMeta } from '../../shared/docs/catalog';
import { useOverlay } from '../hooks/useOverlay';
import type { DocsState } from '../model/useDocs';
import { anchorOf, MarkdownView } from './MarkdownView';

interface DocReaderProps {
  docs: DocsState;
  onOpenFile: (path: string) => void;
}

export function DocReader({ docs, onOpenFile }: DocReaderProps): JSX.Element | null {
  const modalRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useOverlay(modalRef, docs.closeDoc);

  const path = docs.openPath;
  const meta: DocMeta | undefined = useMemo(
    () => docs.docs.find((d) => d.path === path),
    [docs.docs, path],
  );
  if (!path) {
    return null;
  }
  const content = docs.contentByPath[path];

  // Resolve a relative link against this doc's directory, then open it.
  const navigate = (href: string) => {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const parts = (dir ? dir.split('/') : []).concat(href.split('/'));
    const out: string[] = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    docs.openDoc(out.join('/'));
  };

  const jumpTo = (text: string) => {
    const el = bodyRef.current?.querySelector(`#${CSS.escape(anchorOf(text))}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="atlas-overlay" role="presentation" onMouseDown={docs.closeDoc}>
      <div
        className="atlas-modal atlas-reader"
        role="dialog"
        aria-modal="true"
        aria-label={meta?.title ?? path}
        tabIndex={-1}
        ref={modalRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="atlas-modal__header">
          <div>
            <div className="atlas-modal__title">{meta?.title ?? path}</div>
            <div className="atlas-modal__subtitle">{path}</div>
          </div>
          <div className="atlas-reader__actions">
            <button
              type="button"
              className="atlas-button atlas-button--small"
              onClick={() => onOpenFile(path)}
              title="Open the file in the editor"
            >
              Open in editor ↗
            </button>
            <button type="button" className="atlas-icon-button" onClick={docs.closeDoc} aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <div className="atlas-reader__body">
          {meta && meta.headings.length > 1 && (
            <nav className="atlas-reader__outline" aria-label="Document outline">
              {meta.headings.map((h, i) => (
                <button
                  key={`${h.text}-${i}`}
                  type="button"
                  className={`atlas-reader__outline-item atlas-reader__outline-item--d${Math.min(h.depth, 4)}`}
                  onClick={() => jumpTo(h.text)}
                >
                  {h.text}
                </button>
              ))}
            </nav>
          )}
          <div className="atlas-reader__content" ref={bodyRef}>
            {!content && <div className="atlas-reader__loading">Loading…</div>}
            {content?.error && <div className="atlas-reader__error">{content.error}</div>}
            {content?.text !== undefined && <MarkdownView text={content.text} onNavigate={navigate} />}
          </div>
        </div>
      </div>
    </div>
  );
}
