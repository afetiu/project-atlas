/**
 * Renders the typed Markdown AST as React elements — never raw HTML, so any
 * repo's documentation is XSS-safe by construction. Relative links to other
 * Markdown files navigate inside the reader; external links open normally
 * (VS Code webviews route them to the system browser).
 */

import { Fragment, useMemo } from 'react';

import { parseMarkdown, type DocBlock, type InlineNode } from '../../shared/docs/markdown';

interface MarkdownViewProps {
  text: string;
  /** Called with a workspace-relative path when a relative .md link is clicked. */
  onNavigate: (relativeHref: string) => void;
}

export function MarkdownView({ text, onNavigate }: MarkdownViewProps): JSX.Element {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="atlas-md">
      {blocks.map((block, index) => (
        <Block key={index} block={block} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function Block({ block, onNavigate }: { block: DocBlock; onNavigate: (href: string) => void }): JSX.Element {
  switch (block.kind) {
    case 'heading': {
      const Tag = (`h${Math.min(block.depth, 6)}` as unknown) as 'h1';
      return (
        <Tag className={`atlas-md__h atlas-md__h${block.depth}`} id={anchorOf(block.text)}>
          <Inlines nodes={block.inlines} onNavigate={onNavigate} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="atlas-md__p">
          <Inlines nodes={block.inlines} onNavigate={onNavigate} />
        </p>
      );
    case 'code':
      return (
        <pre className="atlas-md__code" data-lang={block.lang || undefined}>
          {block.lang && <span className="atlas-md__code-lang">{block.lang}</span>}
          <code>{block.text}</code>
        </pre>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className="atlas-md__list">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inlines nodes={item} onNavigate={onNavigate} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote className="atlas-md__quote">
          <Inlines nodes={block.inlines} onNavigate={onNavigate} />
        </blockquote>
      );
    case 'table':
      return (
        <div className="atlas-md__tablewrap">
          <table className="atlas-md__table">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i}>
                    <Inlines nodes={cell} onNavigate={onNavigate} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <Inlines nodes={cell} onNavigate={onNavigate} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'hr':
      return <hr className="atlas-md__hr" />;
  }
}

function Inlines({ nodes, onNavigate }: { nodes: InlineNode[]; onNavigate: (href: string) => void }): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case 'text':
            return <Fragment key={index}>{node.text}</Fragment>;
          case 'bold':
            return (
              <strong key={index}>
                <Inlines nodes={node.children} onNavigate={onNavigate} />
              </strong>
            );
          case 'italic':
            return (
              <em key={index}>
                <Inlines nodes={node.children} onNavigate={onNavigate} />
              </em>
            );
          case 'code':
            return (
              <code key={index} className="atlas-md__inlinecode">
                {node.text}
              </code>
            );
          case 'link': {
            const isRelativeDoc = !/^[a-z]+:/i.test(node.href) && /\.md(#.*)?$/i.test(node.href);
            if (isRelativeDoc) {
              return (
                <a
                  key={index}
                  className="atlas-md__link"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate(node.href.replace(/#.*$/, ''));
                  }}
                >
                  <Inlines nodes={node.children} onNavigate={onNavigate} />
                </a>
              );
            }
            const external = /^https?:/i.test(node.href);
            return external ? (
              <a key={index} className="atlas-md__link" href={node.href}>
                <Inlines nodes={node.children} onNavigate={onNavigate} />
              </a>
            ) : (
              <span key={index} className="atlas-md__link atlas-md__link--inert" title={node.href}>
                <Inlines nodes={node.children} onNavigate={onNavigate} />
              </span>
            );
          }
        }
      })}
    </>
  );
}

export function anchorOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
