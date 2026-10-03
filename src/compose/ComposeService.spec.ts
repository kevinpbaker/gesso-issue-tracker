import { describe, expect, it } from 'vitest';

import { IssueStore } from '../model/IssueStore';
import type { TextStore } from '../model/persistence';
import { seedWorkspace } from '../model/seed';
import { EMPTY_DRAFT, type Draft } from './ComposeContract';
import { ComposeService } from './ComposeService';

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

const make = () => {
  const store = new IssueStore(seedWorkspace({ issues: 300 }), 1, () => 7);
  const disk = new MemoryDisk();
  return { store, disk, compose: new ComposeService(store, disk) };
};

const draft = (over: Partial<Draft>): Draft => ({ ...EMPTY_DRAFT, title: 'Login loops on Safari', ...over });

describe('composing an issue', () => {
  it('files a draft as the next issue in its team, at the top of its state', () => {
    const { store, compose } = make();
    const last = Math.max(...[...store.issues()].filter(i => i.teamId === 'api').map(i => Number(i.key.split('-')[1])));
    const top = Math.min(...[...store.issues()].filter(i => i.stateId === 'in-progress').map(i => i.rank));
    compose.file(draft({ teamId: 'api', stateId: 'in-progress', assigneeId: 'u3', labelIds: ['l1'], priority: 2, description: '- [ ] repro' }));
    const filed = compose.filed.value!;
    expect(filed.key).toBe(`API-${last + 1}`);
    expect(store.byKey(filed.key)).toMatchObject({
      title: 'Login loops on Safari',
      teamId: 'api',
      stateId: 'in-progress',
      assigneeId: 'u3',
      labelIds: ['l1'],
      priority: 2,
      description: '- [ ] repro',
      createdAt: 7
    });
    expect(store.byKey(filed.key)!.rank).toBeLessThan(top);
    expect(store.activityOf(store.byKey(filed.key)!.id)[0]!.kind).toBe('created');
  });

  it('numbers each issue after the last, and never reuses a number', () => {
    const { store, compose } = make();
    compose.file(draft({}));
    const first = compose.filed.value!.key;
    store.undo();
    compose.file(draft({}));
    const second = compose.filed.value!.key;
    expect(Number(second.split('-')[1])).toBe(Number(first.split('-')[1]) + 1);
  });

  it('keeps the choices but not the words for the next one in Create more, and clears the rest otherwise', () => {
    const { compose } = make();
    compose.file(draft({ teamId: 'mob', assigneeId: 'u2', labelIds: ['l0'], description: 'x', createMore: true }));
    expect(compose.draft.value).toMatchObject({ title: '', description: '', teamId: 'mob', assigneeId: 'u2', labelIds: ['l0'], createMore: true });
    compose.file(draft({ teamId: 'mob', assigneeId: 'u2' }));
    expect(compose.draft.value).toEqual({ ...EMPTY_DRAFT, teamId: 'mob' });
  });

  it('refuses a draft with no title', () => {
    const { store, compose } = make();
    const size = store.size;
    compose.file(draft({ title: '   ' }));
    expect(store.size).toBe(size);
    expect(compose.filed.value).toBeNull();
  });

  it('saves the draft to disk and reads it back, repairing what no longer exists', async () => {
    const { store, disk, compose } = make();
    await compose.restore();
    expect(compose.draft.value).toEqual(EMPTY_DRAFT);
    compose.save(draft({ assigneeId: 'u4', labelIds: ['l2', 'gone'], description: '**half** written' }));
    await compose.flush();
    const again = new ComposeService(store, disk);
    await again.restore();
    expect(again.draft.value).toMatchObject({ title: 'Login loops on Safari', assigneeId: 'u4', labelIds: ['l2'], description: '**half** written' });
    disk.saved.set('draft-v1', '{not json');
    await again.restore();
    expect(again.draft.value).toEqual(EMPTY_DRAFT);
  });
});
