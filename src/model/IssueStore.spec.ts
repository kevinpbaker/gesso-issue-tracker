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

  it('links two issues, both ways, as one undoable step with news on both', () => {
    const store = make();
    const link = { id: 'rx', fromId: 'i1', toId: 'i2', kind: 'blocks' as const };
    store.relate(link);
    expect(store.relationsOf('i1')).toContainEqual(link);
    expect(store.relationsOf('i2')).toContainEqual(link);
    expect(store.activityOf('i1').at(-1)).toMatchObject({ kind: 'related', relation: link });
    expect(store.activityOf('i2').at(-1)).toMatchObject({ kind: 'related', relation: link });
    // The same link again, or a related link either way round, is nothing.
    expect(store.relate({ ...link, id: 'ry' })).toBeNull();
    store.relate({ id: 'rz', fromId: 'i1', toId: 'i2', kind: 'related' });
    expect(store.relate({ id: 'rw', fromId: 'i2', toId: 'i1', kind: 'related' })).toBeNull();
    store.undo();
    store.undo();
    expect(store.relationsOf('i1')).not.toContainEqual(link);
    store.redo();
    expect(store.relationsOf('i1')).toContainEqual(link);
    store.unrelate('rx', 'i2');
    expect(store.relationsOf('i1')).not.toContainEqual(link);
    expect(store.activityOf('i2').at(-1)!.kind).toBe('unrelated');
  });

  it('keeps each parent’s sub-issues as issues move between parents', () => {
    const store = make();
    store.update(['i5', 'i6'], { parentId: 'i1' }, 'Make sub-issues');
    expect(store.childrenOf('i1').map(issue => issue.id)).toEqual(expect.arrayContaining(['i5', 'i6']));
    store.update(['i6'], { parentId: 'i2' }, 'Move');
    expect(store.childrenOf('i1').map(issue => issue.id)).not.toContain('i6');
    expect(store.childrenOf('i2').map(issue => issue.id)).toContain('i6');
    store.undo();
    expect(store.childrenOf('i2').map(issue => issue.id)).not.toContain('i6');
    expect(store.childrenOf('i1').map(issue => issue.id)).toContain('i6');
  });

  it('saves links made and taken away, and sub-issues, through its overlay', () => {
    const store = make();
    const seeded = store.workspace.relations[0]!;
    const end = seeded.fromId;
    store.unrelate(seeded.id, end);
    store.relate({ id: 'rx', fromId: 'i1', toId: 'i2', kind: 'duplicates' });
    store.update(['i7'], { parentId: 'i3', estimate: 5, dueDate: '2026-11-02' }, 'Plan');
    const overlay = JSON.parse(JSON.stringify(store.exportOverlay()));

    const fresh = make();
    fresh.importOverlay(overlay);
    expect(fresh.relationsOf(end).map(entry => entry.id)).not.toContain(seeded.id);
    expect(fresh.relationsOf('i2').map(entry => entry.id)).toContain('rx');
    expect(fresh.childrenOf('i3').map(issue => issue.id)).toContain('i7');
    expect(fresh.get('i7')).toMatchObject({ estimate: 5, dueDate: '2026-11-02' });
  });

  it('reads an overlay saved before links and sub-issues existed', () => {
    const store = make();
    store.update(['i3'], { title: 'Old' }, 'Rename');
    const overlay = JSON.parse(JSON.stringify(store.exportOverlay()));
    delete overlay.relations;
    delete overlay.unrelated;
    for (const issue of overlay.issues) {
      delete issue.estimate;
      delete issue.dueDate;
      delete issue.parentId;
    }
    const fresh = make();
    expect(fresh.importOverlay(overlay)).toBe(true);
    expect(fresh.get('i3')).toMatchObject({ title: 'Old', estimate: null, dueDate: null, parentId: null });
  });

  it('keeps a run of description edits as one line in the feed', () => {
    let now = 1_000;
    const store = new IssueStore(seedWorkspace({ issues: 10 }), 1, () => now);
    const original = store.get('i0')!.description;
    store.update(['i0'], { description: 'one' }, 'Edit');
    now += 60_000;
    store.update(['i0'], { description: 'two' }, 'Edit');
    expect(store.activityOf('i0')).toHaveLength(1);
    expect(store.activityOf('i0')[0]!.changes[0]).toMatchObject({ from: original, to: 'two' });
    expect(store.exportOverlay().activity).toHaveLength(1);
    // Each save is still its own undo step.
    store.undo();
    expect(store.get('i0')!.description).toBe('one');
    // Much later, it's a new edit.
    now += 3_600_000;
    store.update(['i0'], { description: 'three' }, 'Edit');
    expect(store.activityOf('i0')).toHaveLength(2);
  });
});
