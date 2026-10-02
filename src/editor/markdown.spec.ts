import { describe, expect, it } from 'vitest';

import { seedWorkspace } from '../model/seed';
import { covers, inlineRuns } from './inline';
import { block, inputRule, parse, serialize, type Block } from './markdown';

const shape = (blocks: readonly Block[]) => blocks.map(({ id: _id, ...rest }) => rest);

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
        '1. first',
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
        '---'
      ].join('\n')
    );
    expect(shape(blocks)).toEqual([
      { type: 'heading', text: 'Title', level: 1 },
      { type: 'paragraph', text: 'A paragraph\nwith a soft break.' },
      { type: 'bullet', text: 'one', indent: 0 },
      { type: 'bullet', text: 'nested', indent: 1 },
      { type: 'ordered', text: 'first', indent: 0 },
      { type: 'task', text: 'open', indent: 0, checked: false },
      { type: 'task', text: 'done', indent: 0, checked: true },
      { type: 'quote', text: 'quoted\ntwice' },
      { type: 'code', text: 'const a = 1;\n\nconst b = 2;', lang: 'ts' },
      { type: 'rule', text: '' }
    ]);
  });

  it('keeps what it does not model, verbatim', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |';
    const html = '<details>\n<summary>More</summary>\n</details>';
    const source = `Before\n\n${table}\n\n${html}\n\nAfter`;
    const blocks = parse(source);
    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'raw', 'raw', 'paragraph']);
    expect(serialize(blocks)).toBe(source);
  });
});

describe('serialize', () => {
  it('numbers ordered lists, restarting after an interruption', () => {
    const blocks = [
      block('ordered', 'a', { indent: 0 }),
      block('ordered', 'b', { indent: 0 }),
      block('ordered', 'b.1', { indent: 1 }),
      block('ordered', 'c', { indent: 0 }),
      block('paragraph', 'break'),
      block('ordered', 'again', { indent: 0 })
    ];
    expect(serialize(blocks)).toBe('1. a\n2. b\n  1. b.1\n3. c\n\nbreak\n\n1. again');
  });

  it('round-trips every seeded description exactly', () => {
    for (const issue of seedWorkspace({ issues: 300 }).issues) {
      expect(serialize(parse(issue.description))).toBe(issue.description);
    }
  });

  it('is stable after one pass on loose input', () => {
    const loose = '#  Spaced\n* star\n+ plus\n3) paren\n\n\n\npara\n___';
    const once = serialize(parse(loose));
    expect(serialize(parse(once))).toBe(once);
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
    expect(runs.find(run => run.text === 'ada')).toMatchObject({ fontWeight: 600 });
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
