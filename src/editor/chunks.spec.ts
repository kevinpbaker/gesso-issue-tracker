import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { chunk } from './chunks';

const ids = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ({ id: `b${from + i}` }));
const limits = { max: 8, min: 2 };

describe('chunking a document', () => {
  it('keeps every block, once, in order', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.array(fc.integer({ min: 0, max: 199 })), (count, picked) => {
        const blocks = ids(count);
        const chunks = chunk(blocks, new Set(picked.map(i => `b${i}`)), limits);
        expect([...chunks.values()].flat()).toEqual(blocks.map(b => b.id));
        for (const [start, members] of chunks) {
          expect(members[0]).toBe(start);
          expect(members.length).toBeLessThanOrEqual(limits.max);
        }
      })
    );
  });

  it('leaves every other chunk alone when a block goes in or comes out', () => {
    const blocks = ids(40);
    const before = chunk(blocks, new Set(), limits);
    const starts = new Set(before.keys());
    const inserted = [...blocks.slice(0, 13), { id: 'new' }, ...blocks.slice(13)];
    const after = chunk(inserted, starts, limits);
    const changed = [...after].filter(([start, members]) => before.get(start)?.join() !== members.join());
    expect(changed).toHaveLength(1);
    expect(changed[0]![1]).toContain('new');

    const removed = chunk(blocks.filter(b => b.id !== 'b20'), starts, limits);
    expect([...removed].filter(([start, members]) => before.get(start)?.join() !== members.join())).toHaveLength(1);
  });

  it('splits a chunk that grows past the limit, and merges one that shrinks below it', () => {
    const blocks = ids(8);
    const starts = new Set(chunk(blocks, new Set(), limits).keys());
    const grown = chunk([...blocks, ...ids(4, 100)], starts, limits);
    expect([...grown.values()].every(members => members.length <= limits.max)).toBe(true);
    expect(grown.size).toBeGreaterThan(1);

    const tiny = chunk(ids(3), new Set(['b0', 'b1', 'b2']), limits);
    expect(tiny.size).toBe(1);
  });
});
