import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { IssueStore } from '../model/IssueStore';
import { DEFAULT_QUERY } from '../model/query';
import { seedWorkspace } from '../model/seed';
import { IssueQueryService, OVERSCAN } from './IssueQueryService';

const make = () => {
  const store = new IssueStore(seedWorkspace({ issues: 1_000 }));
  return { store, service: new IssueQueryService(store) };
};

describe('the issue query service', () => {
  it('publishes the window as positions and the rows by ID', async () => {
    const { service } = make();
    service.setWindow({ start: 100, end: 110 });
    const window = await firstValueFrom(service.window);
    const rows = await firstValueFrom(service.rows);
    const positions = Object.keys(window).map(Number);
    expect(Math.min(...positions)).toBe(100 - OVERSCAN);
    expect(Math.max(...positions)).toBe(110 + OVERSCAN - 1);
    expect(Object.keys(rows).sort()).toEqual(Object.values(window).sort());
  });

  it('re-runs when the query changes', async () => {
    const { service } = make();
    service.setQuery({ ...DEFAULT_QUERY, filter: { teamIds: ['ops'] } });
    const rows = await firstValueFrom(service.rows);
    expect(Object.values(rows).every(row => row.key.startsWith('OPS-'))).toBe(true);
  });

  it('follows an edit, and the edit is undoable from here', async () => {
    const { store, service } = make();
    service.setQuery({ ...DEFAULT_QUERY, filter: { priorities: [1] }, group: 'none' });
    const before = (await firstValueFrom(service.summary)).total;
    const id = Object.values(await firstValueFrom(service.window))[0]!;
    store.update([id], { priority: 4 }, 'Lower priority');
    expect((await firstValueFrom(service.summary)).total).toBe(before - 1);
    expect(await firstValueFrom(service.undoLabel)).toBe('Lower priority');
  });

  it('names what a row shows', async () => {
    const { service } = make();
    const row = Object.values(await firstValueFrom(service.rows))[0]!;
    expect(row.stateName).toMatch(/Backlog|Todo|In Progress|In Review|Done/);
    expect(typeof row.initials).toBe('string');
  });
});

describe('bulk edits', () => {
  it('resolves a selection of ranges to the issues at those positions', async () => {
    const { service } = make();
    service.setQuery({ ...DEFAULT_QUERY, group: 'none' });
    await firstValueFrom(service.summary);
    expect(service.idsIn([[0, 2], [2, 3], [10, 10]])).toHaveLength(5);
    expect(service.idsIn([[3, 0]])).toHaveLength(4);
    expect(service.idsIn([[995, 5000]])).toHaveLength(5);
  });

  it('edits 500 issues of 50,000 as one undo, and re-queries, inside the budget', async () => {
    const store = new IssueStore(seedWorkspace({ issues: 50_000 }));
    const service = new IssueQueryService(store);
    service.setQuery({ ...DEFAULT_QUERY, group: 'none', sort: { field: 'key', direction: 'asc' } });
    const summaries: number[] = [];
    const subscription = service.summary.subscribe(summary => summaries.push(summary.total));
    const ids = service.idsIn([[0, 499]]);
    const before = ids.map(id => store.get(id)!.priority);
    const started = performance.now();
    store.update(ids, { priority: 1 }, 'Set priority to Urgent');
    const elapsed = performance.now() - started;
    subscription.unsubscribe();
    expect(ids).toHaveLength(500);
    expect(ids.every(id => store.get(id)!.priority === 1)).toBe(true);
    expect(store.undoLabel).toBe('Set priority to Urgent');
    store.undo();
    expect(ids.map(id => store.get(id)!.priority)).toEqual(before);
    // The edit, the transaction and the re-run of the 50,000-issue query together.
    expect(elapsed).toBeLessThan(100);
    expect(summaries.length).toBeGreaterThanOrEqual(2);
  });
});

describe('selection', () => {
  it('keeps the selected issues selected when an edit re-sorts them', async () => {
    const { store, service } = make();
    service.setQuery({ ...DEFAULT_QUERY, group: 'none', sort: { field: 'priority', direction: 'asc' } });
    await firstValueFrom(service.summary);
    service.select([[0, 9]], 'replace');
    const picked = service.selectedIds();
    service.updateSelected({ priority: 4 }, 'Lower priority');
    // They have moved down the list, and they are still the ones selected.
    expect(service.selectedIds().sort()).toEqual(picked.sort());
    expect(picked.every(id => store.get(id)!.priority === 4)).toBe(true);
  });

  it('adds, toggles, and clears on a new filter', async () => {
    const { service } = make();
    service.setQuery({ ...DEFAULT_QUERY, group: 'none' });
    await firstValueFrom(service.summary);
    service.select([[0, 4]], 'replace');
    service.select([[10, 11]], 'add');
    expect(await firstValueFrom(service.selectedCount)).toBe(7);
    service.select([[0, 0]], 'toggle');
    expect(await firstValueFrom(service.selectedCount)).toBe(6);
    service.setQuery({ ...DEFAULT_QUERY, group: 'state' });
    expect(await firstValueFrom(service.selectedCount)).toBe(6);
    service.setQuery({ ...DEFAULT_QUERY, filter: { teamIds: ['web'] } });
    expect(await firstValueFrom(service.selectedCount)).toBe(0);
  });

  it('adds a label without dropping the ones an issue has, as one undo', async () => {
    const { store, service } = make();
    service.setQuery({ ...DEFAULT_QUERY, group: 'none' });
    await firstValueFrom(service.summary);
    service.select([[0, 19]], 'replace');
    const before = new Map(service.selectedIds().map(id => [id, store.get(id)!.labelIds]));
    service.addLabelToSelected('l7', 'Add label Tech debt');
    for (const [id, labels] of before) {
      expect(store.get(id)!.labelIds).toEqual(labels.includes('l7') ? labels : [...labels, 'l7']);
    }
    store.undo();
    for (const [id, labels] of before) expect(store.get(id)!.labelIds).toEqual(labels);
  });

  it('publishes which window rows are selected', async () => {
    const { service } = make();
    service.setQuery({ ...DEFAULT_QUERY, group: 'none' });
    service.setWindow({ start: 0, end: 10 });
    await firstValueFrom(service.summary);
    service.select([[2, 3]], 'replace');
    const window = await firstValueFrom(service.window);
    expect(Object.keys(await firstValueFrom(service.selected)).sort()).toEqual([window['2'], window['3']].sort());
  });
});
