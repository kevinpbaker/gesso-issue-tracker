import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { block, detached, parse, serialize, type Block, type BlockType } from './markdown';

/**
 * Round trips over generated input, the way Gesso checks layout against
 * a reference: many small random cases rather than a few chosen ones.
 */

/** Characters that mean something in markdown, mixed with ones that don't. */
const CHARS = ['a', 'b', ' ', '#', '-', '*', '+', '_', '`', '~', '>', '<', '[', ']', '(', ')', '1', '.', '!', '=', '\\', '|', '@'];

const word = fc.array(fc.constantFrom(...CHARS), { minLength: 1, maxLength: 12 }).map(chars => chars.join(''));

/** A line of text as someone types it: no leading or trailing space, never blank. */
const line = word.map(text => text.trim()).filter(text => text !== '');

const lines = fc.array(line, { minLength: 1, maxLength: 3 }).map(parts => parts.join('\n'));

const leaf = fc.oneof(
  lines.map(text => block('paragraph', text)),
  fc.tuple(fc.integer({ min: 1, max: 6 }), line).map(([level, text]) => block('heading', text, { level })),
  fc.tuple(fc.integer({ min: 1, max: 2 }), line).map(([level, text]) => block('heading', text, { level, setext: true })),
  lines.map(text => block('quote', text)),
  fc
    .tuple(fc.array(word, { maxLength: 3 }), fc.constantFrom(undefined, 'ts', 'js'))
    .map(([body, lang]) => block('code', body.join('\n'), lang === undefined ? {} : { lang })),
  fc.constant(block('rule', ''))
);

const item = fc.tuple(fc.constantFrom<BlockType>('bullet', 'ordered', 'task'), lines, fc.boolean(), fc.integer({ min: 0, max: 2 }));

/**
 * A document: leaves and runs of list items, each item at most one level
 * deeper than the one before it, as an editor can make them.
 */
// At least one block: an empty document reads back as one empty paragraph, to type into.
const documents = fc.array(fc.oneof(leaf.map(b => [b]), fc.array(item, { minLength: 1, maxLength: 5 })), { minLength: 1, maxLength: 6 }).map(groups => {
  const out: Block[] = [];
  for (const group of groups) {
    if (!Array.isArray(group[0])) {
      out.push(...(group as Block[]));
      continue;
    }
    let depth = -1;
    for (const [type, text, checked, wanted] of group as [BlockType, string, boolean, number][]) {
      depth = Math.min(wanted, depth + 1);
      out.push(
        block(type, text, {
          indent: depth,
          marker: type === 'ordered' ? '.' : '-',
          ...(type === 'task' ? { checked } : {}),
          ...(type === 'ordered' ? { ordinal: 1 } : {})
        })
      );
    }
    // Two lists in a row would read as one; a paragraph between keeps them apart.
    out.push(block('paragraph', 'between'));
  }
  return out;
});

/** What a block is, for comparison: the escapes writing adds at a line's start are layout, not text. */
function shape(b: Block) {
  const text = b.text
    .split('\n')
    .map(part => part.replace(/^\\(?=[^a-zA-Z0-9 ])/, '').replace(/^(\d{1,9})\\([.)])/, '$1$2'))
    .join('\n')
    // A heading's trailing #s are escaped so they aren't read as its closing sequence.
    .replace(/\\(#+)$/, '$1');
  return { type: b.type, text, level: b.level, indent: b.indent ?? 0, checked: b.checked };
}

describe('generated documents', () => {
  it('read back as the blocks that were written', () => {
    fc.assert(
      fc.property(documents, doc => {
        const back = parse(serialize(doc));
        expect(back.map(shape)).toEqual(doc.map(shape));
      }),
      { numRuns: 2000 }
    );
  });
});

describe('generated markdown', () => {
  const markdown = fc
    .array(fc.oneof(line, fc.constant(''), fc.constantFrom('- ', '1. ', '> ', '```', '    ', '  - ', '# ').chain(prefix => line.map(text => prefix + text))), {
      maxLength: 10
    })
    .map(parts => parts.join('\n'));

  it('is written back exactly when untouched', () => {
    fc.assert(
      fc.property(markdown, md => {
        expect(serialize(parse(md))).toBe(md);
      }),
      { numRuns: 3000 }
    );
  });

  // Only for what the editor models. A raw block is promised to survive
  // untouched, which the property above checks; written somewhere new,
  // its meaning can depend on its neighbours (a lazy continuation line
  // reads differently after a blank line than after a paragraph).
  it('is stable after one pass when written fresh', () => {
    fc.assert(
      fc.property(markdown, md => {
        fc.pre(!parse(md).some(b => b.type === 'raw'));
        const once = serialize(parse(md).map(detached));
        expect(serialize(parse(once).map(detached))).toBe(once);
      }),
      { numRuns: 3000 }
    );
  });
});
