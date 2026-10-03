import { describe, expect, it } from 'vitest';

import { block } from './markdown';
import { applySlash, filterSlash, slashQuery } from './slash';

describe('the slash menu', () => {
  it('reads a query after a slash, and nothing else', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/Head')).toBe('head');
    expect(slashQuery('a/b')).toBeNull();
    expect(slashQuery('/path/to/file')).toBeNull();
  });

  it('puts a label that starts with the query first, then any word that does', () => {
    expect(filterSlash('head').map(item => item.value)).toEqual(['h1', 'h2', 'h3']);
    expect(filterSlash('list').map(item => item.value)).toEqual(['bullet', 'ordered', 'task']);
    expect(filterSlash('todo').map(item => item.value)).toEqual(['task']);
    expect(filterSlash('nothing at all')).toEqual([]);
  });

  it('turns the block into the chosen kind, keeping its identity', () => {
    const current = block('paragraph', '/h2');
    expect(applySlash(current, 'h2')).toEqual([{ id: current.id, type: 'heading', level: 2, text: '' }]);
    const [rule, after] = applySlash(current, 'rule');
    expect([rule!.type, after!.type]).toEqual(['rule', 'paragraph']);
  });
});
