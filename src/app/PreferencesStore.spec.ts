import { describe, expect, it } from 'vitest';

import { PreferencesStore } from './PreferencesStore';

const memory = () => {
  const records = new Map<string, string>();
  return {
    records,
    read: async (key: string) => ({ outcome: 'ok', value: records.get(key) ?? null }),
    write: async (key: string, value: string) => (records.set(key, value), 'ok'),
    remove: async (key: string) => (records.delete(key), 'ok')
  };
};

describe('preferences', () => {
  it('survive a restart', async () => {
    const disk = memory();
    const first = new PreferencesStore(disk);
    first.setTheme('dark');
    first.setSidebarOpen(false);
    first.setTourDone(true);
    const second = new PreferencesStore(disk);
    await second.restore();
    expect(second.state.value).toMatchObject({ theme: 'dark', sidebarOpen: false, tourDone: true });
  });

  it('clamp the sidebar and ignore nonsense', async () => {
    const disk = memory();
    disk.records.set('preferences-v1', JSON.stringify({ theme: 'purple', sidebarSplit: 5 }));
    const store = new PreferencesStore(disk);
    await store.restore();
    expect(store.state.value).toEqual({ theme: 'system', sidebarSplit: 0.4, sidebarOpen: true, tourDone: false });
  });
});
