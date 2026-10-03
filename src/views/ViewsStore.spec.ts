import { describe, expect, it } from 'vitest';

import type { TextStore } from '../model/persistence';
import { DEFAULT_QUERY } from '../model/query';
import { ViewsStore } from './ViewsStore';

class MemoryDisk implements TextStore {
  readonly saved = new Map<string, string>();
  async read(key: string) {
    return { outcome: 'ok', value: this.saved.get(key) ?? null };
  }
  async write(key: string, value: string) {
    this.saved.set(key, value);
    return 'ok';
  }
  async remove(key: string) {
    this.saved.delete(key);
    return 'ok';
  }
}

describe('saved views', () => {
  it('saves a query under a name, without its folded groups, and says which', () => {
    const store = new ViewsStore(new MemoryDisk());
    const id = store.save('  My   urgent ', { ...DEFAULT_QUERY, refine: { priorities: [1] }, collapsed: ['done'] })!;
    expect(store.views.value).toEqual([{ id, name: 'My urgent', query: { ...DEFAULT_QUERY, also: [{ priorities: [1] }] } }]);
    expect(store.saved.value).toEqual({ id, serial: 1 });
    expect(store.save('   ', DEFAULT_QUERY)).toBeNull();
  });

  it('renames and removes, and reads it all back from disk', async () => {
    const disk = new MemoryDisk();
    const store = new ViewsStore(disk);
    const a = store.save('A', DEFAULT_QUERY)!;
    const b = store.save('B', DEFAULT_QUERY)!;
    store.rename(a, 'Alpha');
    store.remove(b);
    const again = new ViewsStore(disk);
    await again.restore();
    expect(again.views.value.map(view => view.name)).toEqual(['Alpha']);
    disk.saved.set('views-v1', '[{"id":1},{"nonsense":true}]');
    await again.restore();
    expect(again.views.value).toEqual([]);
  });
});
