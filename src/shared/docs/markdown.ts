/**
 * A small, dependency-free Markdown parser for the docs reader.
 *
 * Parses to a typed block/inline AST that the webview renders as React
 * elements — never raw HTML — so documentation from any repo is XSS-safe by
 * construction. Covers the working set teams actually use in docs: headings,
 * paragraphs, fenced code, lists, blockquotes, tables, rules, links, emphasis,
 * inline code, and images (rendered as labelled links, not fetched).
 */

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: InlineNode[] }
  | { kind: 'italic'; children: InlineNode[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: InlineNode[] };

export type DocBlock =
  | { kind: 'heading'; depth: number; text: string; inlines: InlineNode[] }
  | { kind: 'paragraph'; inlines: InlineNode[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: InlineNode[][] }
  | { kind: 'quote'; inlines: InlineNode[] }
  | { kind: 'table'; header: InlineNode[][]; rows: InlineNode[][][] }
  | { kind: 'hr' };

export interface DocHeading {
  depth: number;
  text: string;
}

export function parseMarkdown(text: string): DocBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: DocBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const raw = heading[2].replace(/\s#+\s*$/, '').trim();
      blocks.push({
        kind: 'heading',
        depth: heading[1].length,
        text: plainText(parseInlines(raw)),
        inlines: parseInlines(raw),
      });
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    // Blockquote (consecutive `>` lines fold into one).
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', inlines: parseInlines(body.join(' ').trim()) });
      continue;
    }

    // Table: header row + separator row.
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line).map(parseInlines);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]).map(parseInlines));
        i += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    // List (flat; nested items are folded into their parent level).
    const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) {
          break;
        }
        items.push(parseInlines(m[2]));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Paragraph: consume until a blank line or a structural line.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !lines[i].match(/^\s*([-*+]|\d+[.)])\s+/)
    ) {
      body.push(lines[i].trim());
      i += 1;
    }
    if (body.length > 0) {
      blocks.push({ kind: 'paragraph', inlines: parseInlines(body.join(' ')) });
    } else {
      i += 1; // safety: never stall
    }
  }

  return blocks;
}

/** Inline parser: code spans first (their content is literal), then links, emphasis. */
export function parseInlines(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let rest = text;

  const push = (node: InlineNode) => out.push(node);

  while (rest.length > 0) {
    // Find the earliest special token.
    const candidates: Array<{ index: number; length: number; make: (m: RegExpMatchArray) => InlineNode; match: RegExpMatchArray }> = [];
    const probe = (re: RegExp, make: (m: RegExpMatchArray) => InlineNode) => {
      const m = rest.match(re);
      if (m && m.index !== undefined) {
        candidates.push({ index: m.index, length: m[0].length, make, match: m });
      }
    };
    probe(/`([^`]+)`/, (m) => ({ kind: 'code', text: m[1] }));
    probe(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, (m) => ({
      kind: 'link',
      href: m[2],
      children: parseInlines(m[1] || m[2]),
    }));
    probe(/\*\*([^*]+)\*\*|__([^_]+)__/, (m) => ({
      kind: 'bold',
      children: parseInlines(m[1] ?? m[2]),
    }));
    probe(/\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/, (m) => ({
      kind: 'italic',
      children: parseInlines(m[1] ?? m[2]),
    }));

    if (candidates.length === 0) {
      push({ kind: 'text', text: rest });
      break;
    }
    candidates.sort((a, b) => a.index - b.index || b.length - a.length);
    const first = candidates[0];
    if (first.index > 0) {
      push({ kind: 'text', text: rest.slice(0, first.index) });
    }
    push(first.make(first.match));
    rest = rest.slice(first.index + first.length);
  }

  return out;
}

/** First H1 (else first heading, else the fallback) as the document title. */
export function extractTitle(text: string, fallback: string): string {
  const h1 = text.match(/^#\s+(.+)$/m);
  if (h1) {
    return plainText(parseInlines(h1[1].trim()));
  }
  const any = text.match(/^#{2,6}\s+(.+)$/m);
  return any ? plainText(parseInlines(any[1].trim())) : fallback;
}

/** Heading outline for the reader's table of contents. */
export function extractHeadings(text: string): DocHeading[] {
  const out: DocHeading[] = [];
  let inFence = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      out.push({ depth: m[1].length, text: plainText(parseInlines(m[2].replace(/\s#+\s*$/, '').trim())) });
    }
  }
  return out;
}

/** First real paragraph, trimmed, for list previews. */
export function excerptOf(text: string, max = 180): string {
  for (const block of parseMarkdown(text)) {
    if (block.kind === 'paragraph') {
      const plain = plainText(block.inlines);
      return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
    }
  }
  return '';
}

export function plainText(inlines: InlineNode[]): string {
  return inlines
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return n.text;
        case 'code':
          return n.text;
        case 'bold':
        case 'italic':
          return plainText(n.children);
        case 'link':
          return plainText(n.children);
      }
    })
    .join('');
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}
