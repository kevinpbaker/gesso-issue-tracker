/**
 * Markdown, as the editor sees it: a flat list of blocks.
 *
 * No framework import and no DOM, so this runs anywhere and is tested
 * in node. The spike's question is whether a block list is the right
 * in-memory shape for an editor whose storage format is markdown; the
 * answer is written up in PHASE0.md.
 *
 * Each block's `text` is its inline markdown source, exactly as typed:
 * `**bold**` stays `**bold**`. The editor styles that string with
 * spans rather than replacing it, because an editable's spans must
 * describe the same string the caret moves through.
 *
 * Supported: paragraphs, ATX headings, bullet, ordered and task lists
 * (nested by two spaces), quotes, fenced code and thematic breaks.
 * Anything else becomes a `raw` block that is kept line for line and
 * written back unchanged, so the editor never loses what it does not
 * understand.
 */

export type BlockType = 'paragraph' | 'heading' | 'bullet' | 'ordered' | 'task' | 'quote' | 'code' | 'rule' | 'raw';

export interface Block {
  readonly id: string;
  readonly type: BlockType;
  /** Inline markdown for text blocks; the body for code; the source lines for raw. */
  readonly text: string;
  /** Heading level, 1 to 6. */
  readonly level?: number;
  /** List nesting depth, from 0. */
  readonly indent?: number;
  readonly checked?: boolean;
  /** A code block's info string. */
  readonly lang?: string;
}

let nextId = 0;
export function blockId(): string {
  nextId += 1;
  return `b${nextId}`;
}

export function block(type: BlockType, text: string, extra: Partial<Omit<Block, 'id' | 'type' | 'text'>> = {}): Block {
  return { id: blockId(), type, text, ...extra };
}

const HEADING = /^(#{1,6}) (.*)$/;
const TASK = /^( *)[-*+] \[([ xX])\] (.*)$/;
const BULLET = /^( *)[-*+] (.*)$/;
const ORDERED = /^( *)\d{1,9}[.)] (.*)$/;
const QUOTE = /^> ?(.*)$/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;
const RULE = /^ {0,3}([-*_])( *\1){2,} *$/;
/** Lines this parser does not model, kept verbatim. */
const RAW = /^( {0,3}\||<[a-zA-Z/!]|\[\^|\s{4,}\S)/;

const LIST_TYPES: ReadonlySet<BlockType> = new Set(['bullet', 'ordered', 'task']);

export function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const close = fence[1]!;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith(close)) {
        body.push(lines[index]!);
        index += 1;
      }
      index += 1; // the closing fence, or the end of the document
      blocks.push(block('code', body.join('\n'), { lang: fence[2]!.trim() }));
      continue;
    }

    if (RULE.test(line)) {
      blocks.push(block('rule', ''));
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push(block('heading', heading[2]!, { level: heading[1]!.length }));
      index += 1;
      continue;
    }

    const task = TASK.exec(line);
    if (task !== null) {
      blocks.push(block('task', task[3]!, { indent: depth(task[1]!), checked: task[2] !== ' ' }));
      index += 1;
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      blocks.push(block('bullet', bullet[2]!, { indent: depth(bullet[1]!) }));
      index += 1;
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered !== null) {
      blocks.push(block('ordered', ordered[2]!, { indent: depth(ordered[1]!) }));
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index]!)) {
        body.push(QUOTE.exec(lines[index]!)![1]!);
        index += 1;
      }
      blocks.push(block('quote', body.join('\n')));
      continue;
    }

    if (RAW.test(line)) {
      const body: string[] = [];
      while (index < lines.length && lines[index]!.trim() !== '') {
        body.push(lines[index]!);
        index += 1;
      }
      blocks.push(block('raw', body.join('\n')));
      continue;
    }

    // A paragraph runs until a blank line or a line that starts something else.
    const body: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim() !== '' && !startsBlock(lines[index]!)) {
      body.push(lines[index]!);
      index += 1;
    }
    blocks.push(block('paragraph', body.join('\n')));
  }

  return blocks;
}

function depth(spaces: string): number {
  return Math.floor(spaces.length / 2);
}

function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    RAW.test(line)
  );
}

export function serialize(blocks: readonly Block[]): string {
  const out: string[] = [];
  /** The running number of each ordered list, by depth. */
  const counters: number[] = [];

  blocks.forEach((current, index) => {
    const previous = blocks[index - 1];
    if (previous !== undefined) {
      const tight = LIST_TYPES.has(previous.type) && LIST_TYPES.has(current.type);
      out.push(tight ? '\n' : '\n\n');
    }
    // Numbering restarts after anything that is not a list, and at a
    // depth where a different kind of item interrupted it.
    if (!LIST_TYPES.has(current.type)) {
      counters.length = 0;
    } else if (current.type !== 'ordered') {
      counters.length = Math.min(counters.length, current.indent ?? 0);
    }
    out.push(line(current, counters));
  });

  return out.join('');
}

function line(current: Block, counters: number[]): string {
  const pad = '  '.repeat(current.indent ?? 0);
  switch (current.type) {
    case 'heading':
      return `${'#'.repeat(current.level ?? 1)} ${current.text}`;
    case 'bullet':
      return `${pad}- ${current.text}`;
    case 'task':
      return `${pad}- [${current.checked === true ? 'x' : ' '}] ${current.text}`;
    case 'ordered': {
      const at = current.indent ?? 0;
      counters.length = at + 1;
      counters[at] = (counters[at] ?? 0) + 1;
      return `${pad}${counters[at]}. ${current.text}`;
    }
    case 'quote':
      return current.text
        .split('\n')
        .map(part => (part === '' ? '>' : `> ${part}`))
        .join('\n');
    case 'code': {
      const fence = current.text.includes('```') ? '~~~' : '```';
      return `${fence}${current.lang ?? ''}\n${current.text}\n${fence}`;
    }
    case 'rule':
      return '---';
    case 'raw':
    case 'paragraph':
      return current.text;
  }
}

/**
 * Markdown shortcuts typed at the start of a block: `# `, `- `, `1. `,
 * `[ ] `, `> `. Returns the block it becomes, or null.
 */
export function inputRule(current: Block): Block | null {
  if (current.type !== 'paragraph') {
    if ((current.type === 'bullet' || current.type === 'ordered') && /^\[[ xX]?\] /.test(current.text)) {
      return { ...current, type: 'task', text: current.text.replace(/^\[[ xX]?\] /, ''), checked: /^\[[xX]\]/.test(current.text) };
    }
    return null;
  }
  const text = current.text;
  const heading = /^(#{1,6}) /.exec(text);
  if (heading !== null) {
    return { ...current, type: 'heading', level: heading[1]!.length, text: text.slice(heading[0].length) };
  }
  if (/^[-*+] \[[ xX]?\] /.test(text)) {
    return { ...current, type: 'task', indent: 0, checked: /^[-*+] \[[xX]\]/.test(text), text: text.replace(/^[-*+] \[[ xX]?\] /, '') };
  }
  if (/^\[[ xX]?\] /.test(text)) {
    return { ...current, type: 'task', indent: 0, checked: /^\[[xX]\]/.test(text), text: text.replace(/^\[[ xX]?\] /, '') };
  }
  if (/^[-*+] /.test(text)) {
    return { ...current, type: 'bullet', indent: 0, text: text.slice(2) };
  }
  if (/^\d{1,9}[.)] /.test(text)) {
    return { ...current, type: 'ordered', indent: 0, text: text.replace(/^\d{1,9}[.)] /, '') };
  }
  if (/^> /.test(text)) {
    return { ...current, type: 'quote', text: text.slice(2) };
  }
  if (/^(```|~~~)/.test(text) && !text.slice(3).includes('`')) {
    return { ...current, type: 'code', lang: text.slice(3).trim(), text: '' };
  }
  if (/^(---|\*\*\*|___)$/.test(text)) {
    return { ...current, type: 'rule', text: '' };
  }
  return null;
}

/** What Enter in the middle of a block leaves behind it: lists continue, everything else is a paragraph. */
export function continuation(current: Block): Pick<Block, 'type' | 'indent' | 'checked'> {
  switch (current.type) {
    case 'bullet':
    case 'ordered':
      return { type: current.type, indent: current.indent ?? 0 };
    case 'task':
      return { type: 'task', indent: current.indent ?? 0, checked: false };
    default:
      return { type: 'paragraph' };
  }
}

export function isList(type: BlockType): boolean {
  return LIST_TYPES.has(type);
}
