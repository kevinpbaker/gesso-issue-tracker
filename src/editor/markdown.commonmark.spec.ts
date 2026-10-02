import spec from 'commonmark-spec';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { describe, expect, it } from 'vitest';

import { detached, parse, serialize } from './markdown';

/**
 * The editor against every example in the CommonMark spec (0.31.2).
 *
 * Parsing is micromark's, which passes the spec, so what's under test
 * here is ours: how a document is cut into blocks, and how blocks are
 * written back. Two promises, checked on all 652 examples:
 *
 *  - **An untouched document is written back byte for byte**, whatever
 *    it holds, including everything the editor doesn't model.
 *  - **A document whose every block is written fresh means the same**:
 *    its syntax tree, positions aside, equals the original's. That is
 *    the worst case for an edit, since a real edit rewrites one block
 *    and keeps the source around it.
 *
 * Where the second promise doesn't hold, the example is pinned below
 * with the reason, as an expected failure, so fixing one is noticed.
 */

interface Example {
  readonly markdown: string;
  readonly number: number;
  readonly section: string;
}

const examples = (spec as { tests: readonly Example[] }).tests;

/** Examples whose meaning changes when every block is written fresh. */
const DIVERGES: Readonly<Record<number, string>> = {
  257:
    'An indented code block straight after a list item whose marker had extra spaces: written fresh, the item is ' +
    'indented less, and the code block reads as part of it.',
  313: 'The same, for an ordered list whose items were indented by hand.'
};

const OPTIONS = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };

/** The syntax tree a document means, without where anything was. */
function tree(markdown: string): unknown {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(strip);
    }
    if (node === null || typeof node !== 'object') {
      return node;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'position') {
        out[key] = strip(value);
      }
    }
    return out;
  };
  return strip(fromMarkdown(markdown, OPTIONS));
}

const rows = examples.map(example => [example.number, example.section, example.markdown] as const);

describe('the CommonMark spec examples', () => {
  it.each(rows)('%i (%s) is written back exactly when untouched', (_number, _section, markdown) => {
    expect(serialize(parse(markdown))).toBe(markdown);
  });

  const conforming = rows.filter(([number]) => DIVERGES[number] === undefined);
  it.each(conforming)('%i (%s) means the same when every block is written fresh', (_number, _section, markdown) => {
    expect(tree(serialize(parse(markdown).map(detached)))).toEqual(tree(markdown));
  });

  const diverging = rows.filter(([number]) => DIVERGES[number] !== undefined);
  it.fails.each(diverging)('%i (%s) is a known divergence', (_number, _section, markdown) => {
    expect(tree(serialize(parse(markdown).map(detached)))).toEqual(tree(markdown));
  });

  it('pins a reason for every divergence', () => {
    for (const [number, reason] of Object.entries(DIVERGES)) {
      expect(examples.some(example => example.number === Number(number))).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
