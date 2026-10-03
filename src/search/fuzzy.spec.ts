import { describe, expect, it } from 'vitest';

import { fuzzyScore } from './fuzzy';

const rank = (query: string, texts: readonly string[]) =>
  texts
    .map(text => ({ text, score: fuzzyScore(query, text) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.text);

describe('fuzzy matching', () => {
  it('finds letters in order, every word, ignoring case and accents', () => {
    expect(fuzzyScore('stdn', 'Set status: Done')).toBeGreaterThan(0);
    expect(fuzzyScore('done set', 'Set status: Done')).toBeGreaterThan(0);
    expect(fuzzyScore('chloe', 'Assign to Chloé Martin')).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'Set status: Done')).toBe(-1);
    expect(fuzzyScore('done urgent', 'Set status: Done')).toBe(-1);
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('ranks a start over a word start over anywhere over scattered letters', () => {
    expect(rank('back', ['Go to Backlog', 'Backlog', 'Feedback loop', 'Book a check'])).toEqual([
      'Backlog',
      'Go to Backlog',
      'Feedback loop',
      'Book a check'
    ]);
  });

  it('prefers contiguous letters on word starts', () => {
    expect(rank('nis', ['New issue', 'Unassign', 'Done in staging'])[0]).toBe('New issue');
    expect(rank('gtb', ['Go to the board', 'Get the bug'])[0]).toBe('Go to the board');
  });
});
