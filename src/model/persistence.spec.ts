import { describe, expect, it } from 'vitest';

import { IssueStore } from './IssueStore';
import { OVERLAY_KEY, OverlayPersistence, type TextStore } from './persistence';
import { seedWorkspace } from './seed';

class MapStore implements TextStore {
  readonly records = new Map<string, string>();
  writes = 0;
  async read(key: string) {
    return { outcome: 'ok', value: this.records.get(key) ?? null };
  }
  async write(key: string, value: string) {
    this.writes += 1;
    this.records.set(key, value);
    return 'ok';
  }
  async remove(key: string) {
    this.records.delete(key);
    return 'ok';
  }
}

const workspace = seedWorkspace({ issues: 200 });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('overlay persistence', () => {
  it('saves once the changes stop, and restores into a fresh store', async () => {
    const disk = new MapStore();
    const store = new IssueStore(workspace);
    const persistence = new OverlayPersistence(disk, 10);
    persistence.watch(store);
    store.update(['i0'], { title: 'One' }, 'Rename');
    store.update(['i0'], { title: 'Two' }, 'Rename');
    store.update(['i0'], { title: 'Three' }, 'Rename');
    await wait(30);
    expect(disk.writes).toBe(1);

    const fresh = new IssueStore(workspace);
    expect(await new OverlayPersistence(disk).restore(fresh)).toBe('restored');
    expect(fresh.get('i0')!.title).toBe('Three');
  });

  it('flushes immediately when asked', async () => {
    const disk = new MapStore();
    const store = new IssueStore(workspace);
    const persistence = new OverlayPersistence(disk, 10_000);
    persistence.watch(store);
    store.update(['i1'], { priority: 1 }, 'Prioritise');
    await persistence.flush();
    expect(disk.records.has(OVERLAY_KEY)).toBe(true);
  });

  it('says what it found', async () => {
    const disk = new MapStore();
    expect(await new OverlayPersistence(disk).restore(new IssueStore(workspace))).toBe('empty');
    disk.records.set(OVERLAY_KEY, '{not json');
    expect(await new OverlayPersistence(disk).restore(new IssueStore(workspace))).toBe('rejected');
  });

  it('forgets everything on clear', async () => {
    const disk = new MapStore();
    disk.records.set(OVERLAY_KEY, '{}');
    await new OverlayPersistence(disk).clear();
    expect(disk.records.size).toBe(0);
  });
});
