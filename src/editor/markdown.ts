/**
 * Markdown, as the editor sees it: a flat list of blocks.
 *
 * No framework import and no DOM, so this runs anywhere and is tested
 * in node, and can move to `gesso-components` with the editor.
 *
 * **Parsing is CommonMark's, not ours.** The document is parsed by
 * micromark (with the GitHub extensions) into a syntax tree, and the
 * tree is flattened into blocks: paragraphs, headings, list items at a
 * depth, task items, quotes, code and rules. Anything that doesn't fit
 * that shape (a table, raw HTML, a definition, a list item holding two
 * paragraphs or a code block) becomes a `raw` block holding its exact
 * source, shown and saved as written.
 *
 * **Every block keeps the source it came from**, and the text between
 * blocks is kept too, so the blocks partition the document. Saving a
 * block that hasn't changed writes its source back, and saving a
 * document nobody edited reproduces it byte for byte, whatever it
 * contains. Only an edited block is written fresh, in the house style.
 *
 * Each block's `text` is its inline markdown source, exactly as typed:
 * `**bold**` stays `**bold**`. The editor styles that string with
 * spans rather than replacing it, because an editable's spans must
 * describe the same string the caret moves through.
 */

import type { BlockContent, List, ListItem, Root, RootContent as Content } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

export type BlockType = 'paragraph' | 'heading' | 'bullet' | 'ordered' | 'task' | 'quote' | 'code' | 'rule' | 'raw';

export interface Block {
  readonly id: string;
  readonly type: BlockType;
  /** Inline markdown for text blocks; the body for code; the exact source for raw. */
  readonly text: string;
  /** Heading level, 1 to 6. */
  readonly level?: number;
  /** A level 1 or 2 heading written underlined rather than with `#`. */
  readonly setext?: boolean;
  /** List nesting depth, from 0. */
  readonly indent?: number;
  readonly checked?: boolean;
  /** A bullet's marker (`-`, `*`, `+`), or an ordered item's delimiter (`.`, `)`). */
  readonly marker?: string;
  /** An ordered item's number as written. */
  readonly ordinal?: number;
  /** A list item in a loose list: items separated by blank lines. */
  readonly loose?: boolean;
  /** A list item whose own text and the list nested in it are separated by a blank line. */
  readonly spread?: boolean;
  /** Where a parsed list item's marker sat on its line; its source's other lines are indented relative to it. */
  readonly column?: number;
  /** A code block's info string. */
  readonly lang?: string;
  /** Where the block came from; absent for a block the editor made. */
  readonly src?: Source;
}

/** A parsed block's place in the document it came from. */
export interface Source {
  /** The block's own text in the document. */
  readonly text: string;
  /** Everything between the previous block and this one: line breaks, blank lines, indentation. */
  readonly gap: string;
  /** The block's position among the parsed blocks. */
  readonly seq: number;
  /** What the block meant when parsed; a block that still means it is written back as `text`. */
  readonly key: string;
  /** What followed the last block: usually the final newline. Only the last block carries it. */
  readonly trailing?: string;
  /**
   * An ordered item numbered one past the item before it. A list written
   * `1. 2. 3.` is renumbered when an item goes in or comes out; one
   * written `1. 1. 1.` keeps its numbers.
   */
  readonly follows?: boolean;
}

let nextId = 0;
export function blockId(): string {
  nextId += 1;
  return `b${nextId}`;
}

export function block(type: BlockType, text: string, extra: Partial<Omit<Block, 'id' | 'type' | 'text'>> = {}): Block {
  return { id: blockId(), type, text, ...extra };
}

/** What a block means, for deciding whether it still matches its source. */
export function meaning(b: Block): string {
  // Blocks are immutable, and a document is serialized on every edit:
  // each block's meaning is worked out once.
  let known = meanings.get(b);
  if (known === undefined) {
    known = JSON.stringify([b.type, b.text, b.level, b.setext, b.indent, b.checked, b.marker, b.ordinal, b.lang, b.loose, b.spread]);
    meanings.set(b, known);
  }
  return known;
}

const meanings = new WeakMap<Block, string>();

/** A block with its source forgotten, as if the editor had made it. */
export function detached(b: Block): Block {
  const { src: _src, ...rest } = b;
  return rest;
}

const LIST_TYPES: ReadonlySet<BlockType> = new Set(['bullet', 'ordered', 'task']);

export function isList(type: BlockType): boolean {
  return LIST_TYPES.has(type);
}

/** A list item, including one kept as raw source because it holds more than the editor models. */
function isItem(b: Block): boolean {
  return isList(b.type) || (b.type === 'raw' && b.indent !== undefined);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface Span {
  readonly block: Omit<Block, 'id' | 'src'>;
  readonly start: number;
  readonly end: number;
  readonly follows?: boolean;
}

export function parse(markdown: string): Block[] {
  const tree: Root = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const spans: Span[] = [];
  for (const node of tree.children) {
    flatten(node, markdown, spans, 0);
  }
  if (spans.length === 0) {
    // Nothing but whitespace: one empty paragraph to type into, holding
    // the whitespace so an untouched document is still written back.
    const empty = block('paragraph', '');
    return [{ ...empty, src: { text: '', gap: markdown, seq: 0, key: meaning(empty), trailing: '' } }];
  }
  const blocks: Block[] = [];
  let cursor = 0;
  spans.forEach((span, seq) => {
    // Blocks partition the document. A setext heading's range starts at
    // a link definition that precedes it on the same lines (spec example
    // 215), so a range that reaches back into the previous block is
    // trimmed to where that block ended.
    let start = Math.max(span.start, cursor);
    if (span.block.type === 'raw' && span.block.indent === undefined) {
      // Raw source is written back as it is, wherever it ends up, so it
      // takes the indentation its first line started with: the rest of
      // its lines are indented relative to that.
      const lineStart = Math.max(cursor, markdown.lastIndexOf('\n', start - 1) + 1);
      if (/^[ \t]*$/.test(markdown.slice(lineStart, start))) {
        start = lineStart;
      }
    }
    const text = markdown.slice(start, span.end);
    const draft = { id: '', ...span.block, ...(span.block.type === 'raw' ? { text } : {}) } as Block;
    blocks.push({
      ...draft,
      id: blockId(),
      src: {
        text,
        gap: markdown.slice(cursor, start),
        seq,
        key: meaning(draft),
        ...(span.follows === true ? { follows: true } : {}),
        ...(seq === spans.length - 1 ? { trailing: markdown.slice(span.end) } : {})
      }
    });
    cursor = span.end;
  });
  return blocks;
}

function offsets(node: { position?: { start: { offset?: number }; end: { offset?: number } } }): [number, number] {
  return [node.position!.start.offset!, node.position!.end.offset!];
}

function raw(node: Content, markdown: string, spans: Span[]): void {
  const [start, end] = offsets(node);
  spans.push({ block: { type: 'raw', text: markdown.slice(start, end) }, start, end });
}

/** The inline source of a block's phrasing content: from its first child to its last. */
function inlineSource(children: readonly Content[], markdown: string): string {
  if (children.length === 0) {
    return '';
  }
  return markdown.slice(offsets(children[0]!)[0], offsets(children[children.length - 1]!)[1]);
}

function flatten(node: Content, markdown: string, spans: Span[], depth: number): void {
  const [start, end] = offsets(node);
  switch (node.type) {
    case 'paragraph':
      spans.push({ block: { type: 'paragraph', text: markdown.slice(start, end) }, start, end });
      return;
    case 'heading': {
      const setext = !markdown.slice(start, end).trimStart().startsWith('#');
      spans.push({
        block: {
          type: 'heading',
          level: node.depth,
          text: inlineSource(node.children, markdown),
          ...(setext ? { setext: true } : {})
        },
        start,
        end
      });
      return;
    }
    case 'thematicBreak':
      spans.push({ block: { type: 'rule', text: '' }, start, end });
      return;
    case 'code': {
      const opening = markdown.slice(start, end).split('\n', 1)[0]!;
      if (!/^ {0,3}(`{3,}|~{3,})/.test(opening)) {
        // Indented code: kept as written, since nothing about it is editable
        // that a fenced block doesn't do better.
        raw(node, markdown, spans);
        return;
      }
      const lang = [node.lang, node.meta].filter(part => part !== null && part !== undefined).join(' ');
      spans.push({ block: { type: 'code', text: node.value, ...(lang === '' ? {} : { lang }) }, start, end });
      return;
    }
    case 'blockquote': {
      if (!node.children.every(child => child.type === 'paragraph')) {
        raw(node, markdown, spans);
        return;
      }
      const text = markdown
        .slice(start, end)
        .split('\n')
        .map(line => line.replace(/^ {0,3}> ?/, ''))
        .join('\n');
      spans.push({ block: { type: 'quote', text }, start, end });
      return;
    }
    case 'list':
      list(node, markdown, spans, depth);
      return;
    default:
      raw(node, markdown, spans);
  }
}

const MARKER = /^([-*+]|(\d{1,9})([.)]))( {1,4}|[\t]|$)/;

function list(node: List, markdown: string, spans: Span[], depth: number): void {
  let previous: number | undefined;
  for (const item of node.children) {
    previous = listItem(item, node, markdown, spans, depth, previous);
  }
}

/** Flattens one item and what it nests; returns its number, for the next item to follow. */
function listItem(
  item: ListItem,
  parent: List,
  markdown: string,
  spans: Span[],
  depth: number,
  previous: number | undefined
): number | undefined {
  const [start, end] = offsets(item);
  const children = item.children as BlockContent[];
  const [first, ...nested] = children;
  // Its own text, then any lists nested in it; anything else (a second
  // paragraph, code, a quote) and the whole item is kept as written.
  const simple =
    (first === undefined || first.type === 'paragraph') &&
    nested.every(child => child.type === 'list') &&
    (first !== undefined || nested.length === 0);
  const marker = MARKER.exec(markdown.slice(start, end));
  if (!simple || marker === null) {
    spans.push({
      block: {
        type: 'raw',
        text: markdown.slice(start, end),
        indent: depth,
        column: start - (markdown.lastIndexOf('\n', start - 1) + 1),
        ...(parent.spread === true ? { loose: true } : {})
      },
      start,
      end
    });
    return marker?.[2] === undefined ? undefined : Number(marker[2]);
  }

  // The column the item's content starts at: continuation lines are
  // indented to it in the source, and that indentation is layout, not text.
  const lineStart = markdown.lastIndexOf('\n', start - 1) + 1;
  const contentColumn = start - lineStart + marker[0].length;
  const ownEnd = first === undefined ? start + marker[0].trimEnd().length : offsets(first)[1];
  let text = '';
  if (first !== undefined) {
    const lines = markdown.slice(offsets(first)[0], ownEnd).split('\n');
    text = [lines[0]!, ...lines.slice(1).map(line => line.replace(new RegExp(`^ {0,${contentColumn}}`), ''))].join('\n');
  }

  const kind: BlockType = item.checked !== null && item.checked !== undefined ? 'task' : parent.ordered === true ? 'ordered' : 'bullet';
  if (kind === 'task' && first !== undefined && offsets(first)[0] === start + marker[0].length) {
    // The task extension moves the paragraph past the box only when the
    // box is followed by plain text; before emphasis it stays in.
    text = text.replace(/^\[[ xX]\][ \t]?/, '');
  }
  const ordinal = marker[2] === undefined ? undefined : Number(marker[2]);
  spans.push({
    follows: ordinal !== undefined && previous !== undefined && ordinal === previous + 1,
    block: {
      type: kind,
      text,
      indent: depth,
      column: start - lineStart,
      ...(kind === 'task' ? { checked: item.checked === true } : {}),
      marker: marker[3] ?? marker[1]!,
      ...(ordinal !== undefined ? { ordinal } : {}),
      ...(parent.spread === true ? { loose: true } : {}),
      ...(nested.length > 0 && item.spread === true ? { spread: true } : {})
    },
    start,
    end: ownEnd
  });

  for (const child of nested) {
    list(child as List, markdown, spans, depth + 1);
  }
  return ordinal;
}

// ---------------------------------------------------------------------------
// Serializing
// ---------------------------------------------------------------------------

export function serialize(blocks: readonly Block[]): string {
  const out: string[] = [];
  /** The running number of each ordered list, by depth. */
  const counters: (number | undefined)[] = [];
  /** The column each depth's content starts at, so a nested item lines up under its parent's text. */
  const columns: number[] = [];

  blocks.forEach((current, index) => {
    const previous = blocks[index - 1];
    const unchanged = current.src !== undefined && current.src.key === meaning(current);
    const verbatim = unchanged || current.type === 'raw';
    const item = isItem(current);
    const at = current.indent ?? 0;
    /** Where an item's marker goes when it isn't where it was: under its parent's text. */
    const pad = ' '.repeat(columns[at - 1] ?? 0);
    /** Where an item written from its source has its marker, so its other lines can follow it. */
    let marker = pad.length;

    // A block that is still next to the block it followed in the source
    // keeps the source's spacing: blank lines, a loose list, indentation.
    // Anywhere else, the house style.
    const inPlace =
      current.src !== undefined &&
      (previous === undefined ? current.src.seq === 0 : previous.src !== undefined && previous.src.seq === current.src.seq - 1);
    if (inPlace && (verbatim || !item)) {
      out.push(current.src!.gap);
      marker = current.column ?? 0;
    } else if (inPlace) {
      // An item that moved in or out keeps the blank lines before it and
      // takes the indentation of its new depth.
      out.push(current.src!.gap.replace(/[ \t]*$/, ''), pad);
    } else if (previous === undefined) {
      out.push(item ? pad : '');
    } else if (item && isItem(previous)) {
      const nested = (previous.indent ?? 0) < at;
      out.push((nested ? previous.spread === true : current.loose === true) ? '\n\n' : '\n', pad);
    } else if (item) {
      out.push('\n\n', pad);
    } else {
      // A raw block carries its own indentation; a block written from its
      // source keeps the indentation its first line had.
      out.push('\n\n', verbatim && current.type !== 'raw' && current.src !== undefined ? /[ \t]*$/.exec(current.src.gap)![0] : '');
    }

    if (!item) {
      counters.length = 0;
      columns.length = 0;
    } else {
      counters.length = Math.min(counters.length, at + 1);
      columns.length = at;
      if (current.type !== 'ordered') {
        counters[at] = current.type === 'raw' ? current.ordinal : undefined;
      } else if (counters[at] === undefined || (unchanged && current.src!.follows !== true)) {
        // The first item of a list, or one whose number was written by hand.
        counters[at] = current.ordinal ?? 1;
      } else {
        counters[at] = counters[at]! + 1;
      }
    }

    if (verbatim) {
      // An edited raw block is written as its text: for raw, text is source.
      let text = unchanged ? current.src!.text : current.text;
      if (current.type === 'ordered' && counters[at] !== current.ordinal) {
        text = text.replace(/^\d+/, String(counters[at]));
      }
      if (item) {
        // Moved to a new column, the item's other lines move with it.
        text = shift(text, marker - (current.column ?? marker));
        columns[at] = marker + (MARKER.exec(text)?.[0].length ?? 2);
      }
      out.push(text);
      return;
    }
    out.push(write(current, counters, columns));
  });

  const last = blocks.find(b => b.src?.trailing !== undefined);
  out.push(last?.src?.trailing ?? '');
  return out.join('');
}

/** Moves every line after the first right by `by` columns, or left when it's negative. */
function shift(text: string, by: number): string {
  if (by === 0) {
    return text;
  }
  return text
    .split('\n')
    .map((line, index) => {
      if (index === 0 || line === '') {
        return line;
      }
      return by > 0 ? ' '.repeat(by) + line : line.replace(new RegExp(`^ {0,${-by}}`), '');
    })
    .join('\n');
}

/** A block written fresh, without its source. Its indentation is already written. */
function write(current: Block, counters: readonly (number | undefined)[], columns: number[]): string {
  switch (current.type) {
    case 'heading': {
      const level = Math.max(1, Math.min(6, current.level ?? 1));
      if (current.setext === true && level <= 2 && current.text.trim() !== '') {
        return `${escapeLines(current.text)}\n${level === 1 ? '===' : '---'}`;
      }
      const body = current.text.replace(/\n/g, ' ');
      // A trailing run of #s would read as the closing sequence.
      return `${'#'.repeat(level)} ${body.replace(/(^| )(#+)$/, '$1\\$2')}`.trimEnd();
    }
    case 'bullet':
    case 'ordered':
    case 'task': {
      const at = current.indent ?? 0;
      const lead =
        current.type === 'ordered'
          ? `${counters[at] ?? 1}${current.marker === ')' ? ')' : '.'}`
          : current.marker === '*' || current.marker === '+'
            ? current.marker
            : '-';
      const box = current.type === 'task' ? `[${current.checked === true ? 'x' : ' '}] ` : '';
      const column = (columns[at - 1] ?? 0) + lead.length + 1;
      columns[at] = column;
      if (current.text === '') {
        return current.type === 'task' ? `${lead} ${box}`.trimEnd() : lead;
      }
      const lines = escapeLines(current.text).split('\n');
      const written = () => `${lead} ${box}${lines.map((line, i) => (i === 0 || line === '' ? line : ' '.repeat(column) + line)).join('\n')}`;
      if (!readsAsItem(written(), current.type === 'task')) {
        // `- --` is a rule, and `- [ ] x` (or a `[` with `]` on the next
        // line) a task: the marker and the text together can read as
        // something else.
        lines[0] = `\\${lines[0]}`;
      }
      return written();
    }
    case 'quote':
      return escapeLines(current.text)
        .split('\n')
        .map(part => (part === '' ? '>' : `> ${part}`))
        .join('\n');
    case 'code': {
      // A backtick fence can't carry an info string with a backtick in it.
      const tilde = (current.lang ?? '').includes('`');
      const runs = [...current.text.matchAll(tilde ? /~+/g : /`+/g)].map(run => run[0].length);
      const fence = (tilde ? '~' : '`').repeat(Math.max(2, ...runs) + 1);
      // The info string is read with escapes and entities decoded, so it's written with them encoded.
      const info = (current.lang ?? '').replace(/[\\&]/g, '\\$&');
      return `${fence}${info}\n${current.text}${current.text === '' ? '' : '\n'}${fence}`;
    }
    case 'rule':
      return '---';
    case 'raw':
      return current.text;
    case 'paragraph':
      return escapeLines(current.text);
  }
}

/**
 * Escapes each line of inline text that would otherwise start a block,
 * or turn the lines above it into a heading.
 *
 * Whether a line would is asked of the parser rather than guessed from
 * patterns: `<https://example.com>` is a link and `<div>` starts HTML,
 * and three backticks with a backtick after them are a code span, not
 * a fence. Patterns over-escaped all three.
 */
function escapeLines(text: string): string {
  return text
    .split('\n')
    .map((line, index) => escapeLine(line, index === 0))
    .join('\n');
}

const OPTIONS = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };
const breaks = new Map<string, boolean>();

/** Whether a line, at the top of a paragraph or continuing one, is read as something other than its text. */
function breaksParagraph(line: string, first: boolean): boolean {
  const key = `${first ? 1 : 0}${line}`;
  let answer = breaks.get(key);
  if (answer === undefined) {
    const tree = fromMarkdown(first ? line : `a\n${line}`, OPTIONS);
    answer = !(tree.children.length === 1 && tree.children[0]!.type === 'paragraph');
    if (breaks.size > 2000) {
      breaks.clear();
    }
    breaks.set(key, answer);
  }
  return answer;
}

/** Whether a written item, marker and all, reads as one list item holding one paragraph, a task only if it is one. */
function readsAsItem(written: string, task: boolean): boolean {
  const key = `${task ? 't' : 'i'}${written}`;
  let answer = breaks.get(key);
  if (answer === undefined) {
    const [list] = fromMarkdown(written, OPTIONS).children;
    const item = list?.type === 'list' && list.children.length === 1 ? list.children[0]! : undefined;
    answer =
      item !== undefined &&
      (item.checked !== null && item.checked !== undefined) === task &&
      item.children.length === 1 &&
      item.children[0]!.type === 'paragraph';
    breaks.set(key, answer);
  }
  return answer;
}

function escapeLine(line: string, first: boolean): string {
  if (line.trim() === '' || !breaksParagraph(line, first)) {
    return line;
  }
  const at = line.search(/\S/);
  const ordered = /^(\d{1,9})([.)])/.exec(line.slice(at));
  const escaped = ordered !== null ? `${line.slice(0, at)}${ordered[1]}\\${line.slice(at + ordered[1]!.length)}` : `${line.slice(0, at)}\\${line.slice(at)}`;
  return breaksParagraph(escaped, first) ? line : escaped;
}

// ---------------------------------------------------------------------------
// Editing rules
// ---------------------------------------------------------------------------

/**
 * Markdown shortcuts typed at the start of a block: `# `, `- `, `1. `,
 * `[ ] `, `> `. Returns the block it becomes, or null.
 */
export function inputRule(current: Block): Block | null {
  if (current.type !== 'paragraph') {
    if ((current.type === 'bullet' || current.type === 'ordered') && /^\[[ xX]?\] /.test(current.text)) {
      return {
        ...current,
        type: 'task',
        marker: current.type === 'bullet' ? current.marker : '-',
        ordinal: undefined,
        text: current.text.replace(/^\[[ xX]?\] /, ''),
        checked: /^\[[xX]\]/.test(current.text)
      };
    }
    return null;
  }
  const text = current.text;
  const heading = /^(#{1,6}) /.exec(text);
  if (heading !== null) {
    return { ...current, type: 'heading', level: heading[1]!.length, text: text.slice(heading[0].length) };
  }
  const task = /^(?:([-*+]) )?\[([ xX]?)\] /.exec(text);
  if (task !== null) {
    return { ...current, type: 'task', indent: 0, marker: task[1] ?? '-', checked: /[xX]/.test(task[2]!), text: text.slice(task[0].length) };
  }
  const bullet = /^([-*+]) /.exec(text);
  if (bullet !== null) {
    return { ...current, type: 'bullet', indent: 0, marker: bullet[1], text: text.slice(2) };
  }
  const ordered = /^(\d{1,9})([.)]) /.exec(text);
  if (ordered !== null) {
    return { ...current, type: 'ordered', indent: 0, marker: ordered[2], ordinal: Number(ordered[1]), text: text.slice(ordered[0].length) };
  }
  if (/^> /.test(text)) {
    return { ...current, type: 'quote', text: text.slice(2) };
  }
  if (/^(```|~~~)/.test(text) && !text.slice(3).includes('`')) {
    return { ...current, type: 'code', lang: text.slice(3).trim() || undefined, text: '' };
  }
  if (/^(---|\*\*\*|___)$/.test(text)) {
    return { ...current, type: 'rule', text: '' };
  }
  return null;
}

/** What Enter in the middle of a block leaves behind it: lists continue, everything else is a paragraph. */
export function continuation(current: Block): Pick<Block, 'type' | 'indent' | 'checked' | 'marker'> {
  switch (current.type) {
    case 'bullet':
    case 'ordered':
      return { type: current.type, indent: current.indent ?? 0, marker: current.marker };
    case 'task':
      return { type: 'task', indent: current.indent ?? 0, checked: false, marker: current.marker };
    default:
      return { type: 'paragraph' };
  }
}
