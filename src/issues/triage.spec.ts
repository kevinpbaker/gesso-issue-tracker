import { describe, expect, it } from 'vitest';

import { IssueStore, type HistoryStep } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';
import { describe as name, triage } from './triage';

const make = () => new IssueStore(seedWorkspace({ issues: 300 }), 1, () => 1_000);

describe('triage', () => {
  it('counts only the issues it changes, and names them', () => {
    const store = make();
    store.update(['i0'], { stateId: 'done' }, 'Setup');
    const ids = ['i0', 'i1', 'i2'];
    for (const id of ['i1', 'i2']) store.update([id], { stateId: 'todo' }, 'Setup');
    triage(store, ids, { field: 'state', stateId: 'done' });
    expect(store.undoLabel).toBe('Moved 2 issues to Done');
    expect(triage(store, ids, { field: 'state', stateId: 'done' })).toBeNull();
  });

  it('adds a label to those without it, and takes it off when every one has it, one undo each', () => {
    const store = make();
    const ids = ['i0', 'i1'];
    store.update(ids, { labelIds: [] }, 'Setup');
    store.update(['i0'], { labelIds: ['l0'] }, 'Setup');
    triage(store, ids, { field: 'label', labelId: 'l0' });
    expect(ids.map(id => store.get(id)!.labelIds)).toEqual([['l0'], ['l0']]);
    expect(store.undoLabel).toBe(`Added Bug to ${store.get('i1')!.key}`);
    triage(store, ids, { field: 'label', labelId: 'l0' });
    expect(ids.map(id => store.get(id)!.labelIds)).toEqual([[], []]);
    expect(store.undoLabel).toBe('Removed Bug from 2 issues');
    store.undo();
    expect(ids.map(id => store.get(id)!.labelIds)).toEqual([['l0'], ['l0']]);
  });

  it('names an issue page change the same way', () => {
    const store = make();
    const issue = { ...store.get('i0')!, labelIds: ['l0'] };
    expect(name(store.workspace, [issue], { assigneeId: null })).toBe(`Unassigned ${issue.key}`);
    expect(name(store.workspace, [issue], { priority: 0 })).toBe(`Cleared the priority of ${issue.key}`);
    expect(name(store.workspace, [issue], { labelIds: [] })).toBe(`Removed Bug from ${issue.key}`);
    expect(name(store.workspace, [issue], { title: 'Renamed' })).toBeNull();
  });
});

describe('the history the undo toast reads', () => {
  it('says what was done, undone and redone, and which is typing', () => {
    const store = make();
    const steps: HistoryStep[] = [];
    store.history.subscribe(step => steps.push(step));
    store.update(['i0'], { priority: 1 }, 'Set priority');
    store.undo();
    store.redo();
    store.update(['i0'], { description: 'Typed' }, 'Edited the description');
    // A reorder changes only bookkeeping, and is still something someone did.
    store.update(['i0'], { rank: 5 }, 'Reordered');
    expect(steps).toEqual([
      { kind: 'do', label: 'Set priority', typing: false },
      { kind: 'undo', label: 'Set priority', typing: false },
      { kind: 'redo', label: 'Set priority', typing: false },
      { kind: 'do', label: 'Edited the description', typing: true },
      { kind: 'do', label: 'Reordered', typing: false }
    ]);
  });
});
