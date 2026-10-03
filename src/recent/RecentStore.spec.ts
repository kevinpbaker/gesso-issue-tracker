import { describe, expect, it } from 'vitest';

import { RECENT_KEPT, RecentStore } from './RecentStore';

const memory = () => {
  const records = new Map<string, string>();
  return {
    records,
    read: async (key: string) => ({ outcome: 'ok', value: records.get(key) ?? null }),
    write: async (key: string, value: string) => (records.set(key, value), 'ok'),
    remove: async (key: string) => (records.delete(key), 'ok')
  };
};

describe('recent issues', () => {
  it('are newest first, each once, and survive a restart', async () => {
    const disk = memory();
    const first = new RecentStore(disk);
    for (const key of ['WEB-1', 'WEB-2', 'API-3', 'WEB-1']) first.viewed(key);
    expect(first.keys.value).toEqual(['WEB-1', 'API-3', 'WEB-2']);
    const second = new RecentStore(disk);
    await second.restore();
    expect(second.keys.value).toEqual(['WEB-1', 'API-3', 'WEB-2']);
    // Under their own key, not the preferences'.
    expect([...disk.records.keys()]).toEqual(['recent-v1']);
  });

  it('keep only the last few', () => {
    const store = new RecentStore(memory());
    for (let i = 1; i <= RECENT_KEPT + 5; i++) store.viewed(`WEB-${i}`);
    expect(store.keys.value).toHaveLength(RECENT_KEPT);
    expect(store.keys.value[0]).toBe(`WEB-${RECENT_KEPT + 5}`);
  });

  it('put what was opened while the record was read ahead of it', async () => {
    const disk = memory();
    disk.records.set('recent-v1', JSON.stringify(['WEB-1', 'WEB-2']));
    const store = new RecentStore(disk);
    const restoring = store.restore();
    store.viewed('WEB-2');
    await restoring;
    expect(store.keys.value).toEqual(['WEB-2', 'WEB-1']);
  });

  it('ignore a record that is nonsense', async () => {
    const disk = memory();
    disk.records.set('recent-v1', '{"not": "a list"');
    const broken = new RecentStore(disk);
    await broken.restore();
    expect(broken.keys.value).toEqual([]);
    disk.records.set('recent-v1', JSON.stringify(['WEB-1', 7, null, 'WEB-1']));
    const mixed = new RecentStore(disk);
    await mixed.restore();
    expect(mixed.keys.value).toEqual(['WEB-1']);
  });

  it('forget the issues that are gone, on disk too', async () => {
    const disk = memory();
    const store = new RecentStore(disk);
    for (const key of ['WEB-1', 'WEB-900', 'WEB-2']) store.viewed(key);
    store.prune(key => key !== 'WEB-900');
    expect(store.keys.value).toEqual(['WEB-2', 'WEB-1']);
    expect(JSON.parse(disk.records.get('recent-v1')!)).toEqual(['WEB-2', 'WEB-1']);
  });
});
