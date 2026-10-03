import { describe, expect, it } from 'vitest';

import { seedWorkspace } from '../model/seed';
import { covers, inlineRuns } from './inline';
import { block, detached, inputRule, parse, serialize, type Block } from './markdown';

const shape = (blocks: readonly Block[]) => blocks.map(({ id: _id, src: _src, column: _column, ...rest }) => rest);

describe('parse', () => {
  it('reads every supported block', () => {
    const blocks = parse(
      [
        '# Title',
        '',
        'A paragraph',
        'with a soft break.',
        '',
        '- one',
        '  - nested',
        '',
        '1. first',
        '',
        '- [ ] open',
        '- [x] done',
        '',
        '> quoted',
        '> twice',
        '',
        '```ts',
        'const a = 1;',
        '',
        'const b = 2;',
        '```',
        '',
        'Underlined',
        '----------',
        '',
        '---'
      ].join('\n')
    );
    expect(shape(blocks)).toEqual([
      { type: 'heading', text: 'Title', level: 1 },
      { type: 'paragraph', text: 'A paragraph\nwith a soft break.' },
      { type: 'bullet', text: 'one', indent: 0, marker: '-' },
      { type: 'bullet', text: 'nested', indent: 1, marker: '-' },
      { type: 'ordered', text: 'first', indent: 0, marker: '.', ordinal: 1 },
      { type: 'task', text: 'open', indent: 0, checked: false, marker: '-' },
      { type: 'task', text: 'done', indent: 0, checked: true, marker: '-' },
      { type: 'quote', text: 'quoted\ntwice' },
      { type: 'code', text: 'const a = 1;\n\nconst b = 2;', lang: 'ts' },
      { type: 'heading', text: 'Underlined', level: 2, setext: true },
      { type: 'rule', text: '' }
    ]);
  });

  it('keeps what it does not model, verbatim', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |';
    const html = '<details>\n<summary>More</summary>\n</details>';
    const loose = '- one\n\n  still one\n- two';
    const source = `Before\n\n${table}\n\n${html}\n\n${loose}\n\nAfter\n`;
    const blocks = parse(source);
    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'raw', 'raw', 'raw', 'bullet', 'paragraph']);
    expect(serialize(blocks)).toBe(source);
  });

  it("takes a list item's continuation indentation as layout, not text", () => {
    const [item] = parse('10. a long\n    item');
    expect(item).toMatchObject({ type: 'ordered', text: 'a long\nitem', ordinal: 10 });
  });
});

describe('serialize', () => {
  it('writes an untouched document back byte for byte', () => {
    const odd = '\n\n#  Spaced  #\n* star\n+ plus\n3) paren\n\n\n\npara\r\nwith CRLF\n___\n\n    indented code\n\n\n';
    expect(serialize(parse(odd))).toBe(odd);
  });

  it('round-trips every seeded description exactly', () => {
    for (const issue of seedWorkspace({ issues: 300 }).issues) {
      expect(serialize(parse(issue.description))).toBe(issue.description);
    }
  });

  it('rewrites only the block that changed', () => {
    const source = '#  Spaced\n\n* star\n* other\n\nend\n';
    const blocks = parse(source);
    const edited = blocks.map(b => (b.text === 'other' ? { ...b, text: 'changed' } : b));
    expect(serialize(edited)).toBe('#  Spaced\n\n* star\n* changed\n\nend\n');
  });

  it('numbers ordered lists, restarting after an interruption', () => {
    const blocks = [
      block('ordered', 'a', { indent: 0 }),
      block('ordered', 'b', { indent: 0 }),
      block('ordered', 'b.1', { indent: 1 }),
      block('ordered', 'c', { indent: 0 }),
      block('paragraph', 'break'),
      block('ordered', 'again', { indent: 0 })
    ];
    // Nested under `2. `, an item is indented to the parent's text: three spaces.
    expect(serialize(blocks)).toBe('1. a\n2. b\n   1. b.1\n3. c\n\nbreak\n\n1. again');
  });

  it('renumbers a numbered list around an insertion, but not one numbered by hand', () => {
    const counted = parse('1. first\n2. second\n');
    expect(serialize([counted[0]!, block('ordered', 'between', { indent: 0 }), counted[1]!])).toBe('1. first\n2. between\n3. second\n');
    const same = parse('1. first\n1. second\n');
    expect(serialize([same[0]!, block('ordered', 'between', { indent: 0 }), same[1]!])).toBe('1. first\n2. between\n1. second\n');
  });

  it('indents an item that moved deeper to its new parent', () => {
    const [a, b] = parse('- a\n- b');
    expect(serialize([a!, { ...b!, indent: 1 }])).toBe('- a\n  - b');
  });

  it('escapes text that would otherwise start a different block', () => {
    const blocks = [block('paragraph', '# not a heading\n- not a list\n---'), block('paragraph', '1. not a list')];
    const written = serialize(blocks);
    expect(written).toBe('\\# not a heading\n\\- not a list\n\\---\n\n1\\. not a list');
    expect(parse(written).map(b => b.type)).toEqual(['paragraph', 'paragraph']);
  });
});

describe('input rules', () => {
  const rule = (text: string) => inputRule(block('paragraph', text));

  it.each([
    ['# ', 'heading'],
    ['### ', 'heading'],
    ['- ', 'bullet'],
    ['* ', 'bullet'],
    ['1. ', 'ordered'],
    ['[ ] ', 'task'],
    ['- [ ] ', 'task'],
    ['> ', 'quote'],
    ['```', 'code'],
    ['---', 'rule']
  ])('turns %j into a %s', (typed, type) => {
    expect(rule(typed)?.type).toBe(type);
  });

  it('leaves ordinary text alone', () => {
    expect(rule('#hashtag')).toBeNull();
    expect(rule('-dash')).toBeNull();
  });

  it('turns a bullet that starts with a box into a task', () => {
    expect(inputRule(block('bullet', '[x] shipped', { indent: 1 }))).toMatchObject({ type: 'task', checked: true, indent: 1, text: 'shipped' });
  });
});

describe('inline runs', () => {
  it('styles each construct and keeps its markers', () => {
    const runs = inlineRuns('a **b** _c_ `d` ~~e~~ [f](g) @ada WEB-12');
    expect(runs.find(run => run.text === 'b')).toMatchObject({ fontWeight: 700 });
    expect(runs.find(run => run.text === 'c')).toMatchObject({ fontStyle: 'italic' });
    expect(runs.find(run => run.text === 'd')?.fontFamily).toContain('monospace');
    expect(runs.find(run => run.text === 'e')).toMatchObject({ textDecoration: 'line-through' });
    expect(runs.find(run => run.text === 'f')).toMatchObject({ color: 'primary' });
    expect(runs.find(run => run.text === 'ada')).toMatchObject({ fontWeight: 600, backgroundColor: 'controlBackground' });
    expect(runs.find(run => run.text === '@')).toMatchObject({ backgroundColor: 'controlBackground' });
    expect(runs.find(run => run.text === 'WEB-12')).toMatchObject({ fontWeight: 600 });
  });

  it('does not treat snake_case or unclosed markers as emphasis', () => {
    expect(inlineRuns('snake_case_name and **open')).toEqual([{ text: 'snake_case_name and **open' }]);
  });

  it('always spells the source, whatever is typed', () => {
    const alphabet = ['a', ' ', '*', '_', '`', '~', '[', ']', '(', ')', '@', 'W', '-', '1'];
    let state = 7;
    for (let trial = 0; trial < 2000; trial += 1) {
      let source = '';
      const length = 1 + (trial % 24);
      for (let i = 0; i < length; i += 1) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        source += alphabet[state % alphabet.length];
      }
      expect(covers(inlineRuns(source), source)).toBe(true);
    }
  });
});

describe('carets between blocks and their markdown', () => {
  it('lands on the same character both ways', async () => {
    const { caretToSource, serializeWithRanges, sourceToCaret } = await import('./markdown');
    const blocks = parse('# Title\n\ntext here\n\n- [ ] task one\n  - nested\n\n```ts\ncode()\n```');
    const markdown = serializeWithRanges(blocks);
    for (const current of blocks) {
      for (const offset of [0, 1, current.text.split('\n')[0]!.length]) {
        const at = caretToSource(blocks, markdown, { id: current.id, offset });
        expect(sourceToCaret(blocks, markdown, at)).toEqual({ id: current.id, offset: Math.min(offset, current.text.length) });
      }
    }
    const task = blocks.find(b => b.type === 'task')!;
    const at = caretToSource(blocks, markdown, { id: task.id, offset: 4 });
    expect(markdown.text.slice(at, at + 3)).toBe(' on');
  });
});

/**
 * Found by the property spec: GFM reads `a\\@a.a` as the email autolink
 * `a@a.a`, and the link node it makes has no position, which parse
 * relied on for a heading's text.
 */
describe('a heading whose inline nodes carry no position', () => {
  it('reads its text from the heading itself, and writes it back', () => {
    for (const md of ['# a\\@a.a', '## see a\\@b.c now ##', 'a\\@a.a\n===']) {
      const blocks = parse(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('heading');
      expect(serialize(blocks)).toBe(md);
      const fresh = serialize(blocks.map(detached));
      expect(serialize(parse(fresh).map(detached))).toBe(fresh);
    }
    expect(parse('# a\\@a.a')[0]!.text).toBe('a\\@a.a');
    expect(parse('## see a\\@b.c now ##')[0]!.text).toBe('see a\\@b.c now');
  });
});

/** Found by the property spec: block text whose lines spell a table. */
describe('text that would read as a table', () => {
  it('is escaped so it reads back as the text it was', () => {
    for (const current of [block('paragraph', 'a|a\n-|-\na'), { ...block('bullet', 'a|a\n-|-\na'), indent: 0, marker: '-' }]) {
      const written = serialize([current]);
      const back = parse(written);
      expect(back).toHaveLength(1);
      expect(back[0]!.type).toBe(current.type);
      expect(serialize(back.map(detached))).toBe(written);
    }
  });
});
