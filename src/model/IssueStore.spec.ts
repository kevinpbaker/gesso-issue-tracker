import { describe, expect, it } from 'vitest';

import { IssueStore, type Transaction } from './IssueStore';
import { seedWorkspace } from './seed';
import type { Issue } from './types';

const make = () => new IssueStore(seedWorkspace({ issues: 300 }), 1, () => 1_000);

describe('the issue store', () => {
  it('applies a patch to several issues as one undoable transaction', () => {
    const store = make();
    const ids = ['i0', 'i1', 'i2'];
    const before = ids.map(id => store.get(id)!.priority);
    store.update(ids, { priority: 1 }, 'Set priority');
    expect(ids.map(id => store.get(id)!.priority)).toEqual([1, 1, 1]);
    expect(store.undoLabel).toBe('Set priority');
    store.undo();
    expect(ids.map(id => store.get(id)!.priority)).toEqual(before);
    store.redo();
    expect(ids.map(id => store.get(id)!.priority)).toEqual([1, 1, 1]);
  });

  it('puts the edit time back on undo', () => {
    let now = 1_000;
    const store = new IssueStore(seedWorkspace({ issues: 10 }), 1, () => now);
    const before = store.get('i0')!.updatedAt;
    now = 5_000;
    store.update(['i0'], { title: 'Renamed' }, 'Rename');
    expect(store.get('i0')!.updatedAt).toBe(5_000);
    now = 9_000;
    store.undo();
    expect(store.get('i0')!.updatedAt).toBe(before);
    store.redo();
    expect(store.get('i0')!.updatedAt).toBe(5_000);
  });

  it('commits nothing when the patch changes nothing', () => {
    const store = make();
    const issue = store.get('i0')!;
    expect(store.update(['i0'], { priority: issue.priority }, 'No-op')).toBeNull();
    expect(store.canUndo).toBe(false);
  });

  it('clears redo when something new is done', () => {
    const store = make();
    store.update(['i0'], { title: 'One' }, 'Rename');
    store.undo();
    store.update(['i1'], { title: 'Two' }, 'Rename');
    expect(store.canRedo).toBe(false);
  });

  it('emits every transaction, undo included', () => {
    const store = make();
    const seen: Transaction[] = [];
    store.changes.subscribe(transaction => seen.push(transaction));
    store.update(['i0'], { title: 'Renamed' }, 'Rename');
    store.undo();
    expect(seen.map(transaction => transaction.label)).toEqual(['Rename', 'Undo Rename']);
  });

  it('records field changes in the activity feed, and leaves rank and undo out', () => {
    const store = make();
    const from = store.get('i0')!.stateId;
    store.update(['i0'], { stateId: 'done', rank: 5 }, 'Move');
    store.update(['i0'], { rank: 6 }, 'Reorder');
    store.undo();
    const feed = store.activityOf('i0');
    expect(feed).toHaveLength(1);
    expect(feed[0]!.changes).toEqual([{ field: 'stateId', from, to: 'done' }]);
  });

  it('creates, comments and undoes both', () => {
    const store = make();
    const issue: Issue = { ...store.get('i0')!, id: 'new', key: 'WEB-9999', title: 'Fresh' };
    store.create(issue);
    store.comment({ id: 'cx', issueId: 'new', authorId: 'u1', body: 'Hi', createdAt: 2 });
    expect(store.commentsOf('new')).toHaveLength(1);
    store.undo();
    expect(store.commentsOf('new')).toHaveLength(0);
    store.undo();
    expect(store.get('new')).toBeUndefined();
  });

  it('round-trips its overlay into a fresh store', () => {
    const store = make();
    store.update(['i3', 'i4'], { title: 'Restored' }, 'Rename');
    store.comment({ id: 'cx', issueId: 'i3', authorId: 'u1', body: 'Saved?', createdAt: 2 });
    const overlay = JSON.parse(JSON.stringify(store.exportOverlay()));

    const fresh = make();
    expect(fresh.importOverlay(overlay)).toBe(true);
    expect(fresh.get('i3')!.title).toBe('Restored');
    expect(fresh.commentsOf('i3').at(-1)!.body).toBe('Saved?');
    expect(fresh.activityOf('i3').map(event => event.kind)).toEqual(['updated', 'commented']);
    // What was restored is not undoable: it was not done in this session.
    expect(fresh.canUndo).toBe(false);
  });

  it('refuses an overlay from another seed or format', () => {
    const store = make();
    const overlay = store.exportOverlay();
    expect(make().importOverlay({ ...overlay, seed: 2 })).toBe(false);
    expect(make().importOverlay({ version: 0 })).toBe(false);
    expect(make().importOverlay('nonsense')).toBe(false);
  });

  it('resets to the seed', () => {
    const store = make();
    const title = store.get('i0')!.title;
    store.update(['i0'], { title: 'Changed' }, 'Rename');
    store.reset();
    expect(store.get('i0')!.title).toBe(title);
    expect(store.exportOverlay().issues).toEqual([]);
    expect(store.canUndo).toBe(false);
  });
});
