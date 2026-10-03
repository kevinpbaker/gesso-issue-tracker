import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { makeLink, MARKERS, toggleMark, type Mark } from './formatting';

describe('toggling a mark', () => {
  it('wraps the selection, keeping it selected', () => {
    expect(toggleMark('make this bold', 5, 9, 'bold')).toEqual({ text: 'make **this** bold', start: 7, end: 11 });
  });

  it('unwraps markers just outside or just inside the selection', () => {
    expect(toggleMark('make **this** bold', 7, 11, 'bold')).toEqual({ text: 'make this bold', start: 5, end: 9 });
    expect(toggleMark('make **this** bold', 5, 13, 'bold')).toEqual({ text: 'make this bold', start: 5, end: 9 });
  });

  it('keeps spaces at the edges outside the markers', () => {
    expect(toggleMark('a word here', 1, 7, 'italic').text).toBe('a _word_ here');
  });

  it('gives an empty pair to type into when nothing is selected', () => {
    expect(toggleMark('ab', 1, 1, 'code')).toEqual({ text: 'a``b', start: 2, end: 2 });
  });

  it('does not read markers around nothing but spaces as a mark', () => {
    // Found by the property below: `_    _` isn't italic, so it gets marked rather than unmarked.
    const once = toggleMark('_    _', 0, 6, 'italic');
    expect(once.text).toBe('__    __');
    expect(toggleMark(once.text, once.start, once.end, 'italic').text).toBe('_    _');
  });

  it('comes back to where it started when toggled twice', () => {
    const marks: Mark[] = ['bold', 'italic', 'code', 'strike'];
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.nat(), fc.nat(), fc.constantFrom(...marks), (text, a, b, mark) => {
        const start = Math.min(a, b) % (text.length + 1);
        const end = Math.max(start, Math.max(a, b) % (text.length + 1));
        if (/^\s|\s$/.test(text.slice(start, end))) {
          return;
        }
        // A run of the marker's character longer than the marker reads
        // more than one way (`__!__` is bold, and also italic around
        // `_!_`), so toggling it can't come back to where it started.
        if (text.includes(MARKERS[mark] + MARKERS[mark][0])) {
          return;
        }
        const once = toggleMark(text, start, end, mark);
        const twice = toggleMark(once.text, once.start, once.end, mark);
        expect(twice.text).toBe(text);
      }),
      { numRuns: 5000 }
    );
  });
});

describe('making a link', () => {
  it('wraps the selection and selects where the address goes', () => {
    const done = makeLink('see the docs', 8, 12);
    expect(done.text).toBe('see the [docs](url)');
    expect(done.text.slice(done.start, done.end)).toBe('url');
  });

  it('selects the link text when nothing was selected', () => {
    const done = makeLink('ab', 1, 1);
    expect(done.text).toBe('a[link](url)b');
    expect(done.text.slice(done.start, done.end)).toBe('link');
  });
});
