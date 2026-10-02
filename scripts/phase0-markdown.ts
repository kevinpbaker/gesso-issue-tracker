/**
 * Phase 0: the spike's own block parser against mdast (micromark).
 *
 *   node --experimental-strip-types scripts/phase0-markdown.ts
 *
 * Three questions, each printed as a line of PHASE0.md §5:
 *  1. Does each round-trip a seeded description byte for byte?
 *  2. What does a full parse of a 5,000-line document cost?
 *  3. What does re-parsing the one block a keystroke touched cost?
 */
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';

import { bigDocument } from '../src/editor/bigDocument.ts';
import { parse, serialize } from '../src/editor/markdown.ts';
import { seedWorkspace } from '../src/model/seed.ts';

const mdastParse = (source: string) => fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
// Configured to the house style the seed writes, so the comparison is
// about fidelity rather than defaults.
const mdastWrite = (tree: ReturnType<typeof mdastParse>) =>
  toMarkdown(tree, {
    extensions: [gfmToMarkdown()],
    bullet: '-',
    emphasis: '_',
    strong: '*',
    rule: '-',
    fences: true,
    listItemIndent: 'one'
  }).replace(/\n$/, '');

function time(label: string, runs: number, work: () => void): number {
  for (let i = 0; i < Math.min(5, runs); i += 1) work();
  const started = performance.now();
  for (let i = 0; i < runs; i += 1) work();
  const each = (performance.now() - started) / runs;
  console.log(`${label.padEnd(44)} ${each < 1 ? `${(each * 1000).toFixed(1)} µs` : `${each.toFixed(2)} ms`}`);
  return each;
}

const descriptions = seedWorkspace({ issues: 300 }).issues.map(issue => issue.description);
const ownExact = descriptions.filter(d => serialize(parse(d)) === d).length;
const mdastExact = descriptions.filter(d => mdastWrite(mdastParse(d)) === d).length;
console.log(`round trip, 300 seeded descriptions          own ${ownExact}/300 · mdast ${mdastExact}/300`);

const sample = descriptions[0]!;
const rewritten = mdastWrite(mdastParse(sample));
if (rewritten !== sample) {
  const a = sample.split('\n');
  const b = rewritten.split('\n');
  const line = a.findIndex((text, i) => text !== b[i]);
  console.log(`  first mdast difference, line ${line + 1}: ${JSON.stringify(a[line])} → ${JSON.stringify(b[line])}`);
}

const big = bigDocument();
console.log(`document: ${big.split('\n').length} lines, ${big.length.toLocaleString('en-US')} chars`);
time('full parse, own', 20, () => parse(big));
time('full parse, mdast', 5, () => mdastParse(big));
time('full serialize, own', 20, () => serialize(parse(big)));

const paragraph = 'Search results stop paging after **page 3** for workspaces with more than _10,000_ issues. Reported by @ada, see WEB-1042.';
time('one block re-parsed, own', 20000, () => parse(paragraph));
time('one block re-parsed, mdast', 2000, () => mdastParse(paragraph));

// Inputs somebody else wrote: does opening and saving change them?
const foreign: Record<string, string> = {
  'table, uneven columns': '| a | bb |\n|---|:-:|\n| 1 | 2 |',
  'raw html block': '<details>\n<summary>More</summary>\n\nHidden\n</details>',
  'star bullets': '* one\n* two',
  'paren ordered list': '1) one\n2) two',
  'setext heading': 'Title\n=====',
  'hard break': 'line one  \nline two',
  'footnote': 'Text[^1]\n\n[^1]: The note.'
};
for (const [name, source] of Object.entries(foreign)) {
  const own = serialize(parse(source)) === source;
  const theirs = mdastWrite(mdastParse(source)) === source;
  console.log(`unchanged after open + save: ${name.padEnd(22)} own ${own ? 'yes' : 'no '} · mdast ${theirs ? 'yes' : 'no'}`);
}
