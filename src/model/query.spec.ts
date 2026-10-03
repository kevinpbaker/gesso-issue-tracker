import { describe, expect, it } from 'vitest';
import { IssueStore } from './IssueStore';
import { SearchIndex } from '../search/SearchIndex';

import { DEFAULT_QUERY, NONE, runQuery, type IssueQuery } from './query';
import { seedWorkspace } from './seed';

const small = seedWorkspace({ issues: 2_000 });
const run = (patch: Partial<IssueQuery>) => runQuery(small, small.issues, { ...DEFAULT_QUERY, ...patch });
const byId = new Map(small.issues.map(issue => [issue.id, issue]));
const issuesOf = (ids: readonly string[]) => ids.map(id => byId.get(id)!);

describe('filtering', () => {
  it('matches every field it is given, and all of them at once', () => {
    const result = run({ filter: { teamIds: ['web'], stateIds: ['todo', 'done'], priorities: [1, 2] }, group: 'none' });
    expect(result.ids.length).toBeGreaterThan(0);
    for (const issue of issuesOf(result.ids)) {
      expect(issue.teamId).toBe('web');
      expect(['todo', 'done']).toContain(issue.stateId);
      expect([1, 2]).toContain(issue.priority);
    }
  });

  it('finds unassigned and project-less issues through NONE', () => {
    const unassigned = run({ filter: { assigneeIds: [NONE] }, group: 'none' });
    expect(issuesOf(unassigned.ids).every(issue => issue.assigneeId === null)).toBe(true);
    expect(unassigned.ids.length).toBe(small.issues.filter(issue => issue.assigneeId === null).length);
  });

  it('matches any of several labels', () => {
    const result = run({ filter: { labelIds: ['l0', 'l1'] }, group: 'none' });
    expect(issuesOf(result.ids).every(issue => issue.labelIds.includes('l0') || issue.labelIds.includes('l1'))).toBe(true);
  });

  it('searches titles and keys without regard to case', () => {
    expect(issuesOf(run({ filter: { text: 'CSV IMPORT' }, group: 'none' }).ids).every(issue => /csv import/i.test(issue.title))).toBe(true);
    expect(issuesOf(run({ filter: { text: 'web-12' }, group: 'none' }).ids).map(issue => issue.key)).toContain('WEB-12');
  });
});

describe('sorting and grouping', () => {
  it('puts urgent first and no priority last', () => {
    const order = issuesOf(run({ group: 'none' }).ids).map(issue => issue.priority);
    expect(order[0]).toBe(1);
    expect(order.at(-1)).toBe(0);
  });

  it('sorts keys numerically within a team', () => {
    const keys = issuesOf(run({ filter: { teamIds: ['web'] }, sort: { field: 'key', direction: 'asc' }, group: 'none' }).ids).map(
      issue => issue.key
    );
    expect(keys.slice(0, 11)).toEqual(Array.from({ length: 11 }, (_, i) => `WEB-${i + 1}`));
  });

  it('cuts groups out of one sorted list, in workflow order', () => {
    const result = run({ group: 'state' });
    expect(result.groups.map(group => group.label)).toEqual(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done']);
    let next = 0;
    for (const group of result.groups) {
      expect(group.start).toBe(next);
      expect(issuesOf(result.ids.slice(group.start, group.start + group.count)).every(issue => issue.stateId === group.key)).toBe(true);
      next += group.count;
    }
    expect(next).toBe(result.ids.length);
  });

  it('leaves collapsed groups out of the ids but keeps their counts', () => {
    const open = run({ group: 'state' });
    const folded = run({ group: 'state', collapsed: ['todo'] });
    const todo = folded.groups.find(group => group.key === 'todo')!;
    expect(todo).toMatchObject({ collapsed: true, shown: 0, count: open.groups.find(g => g.key === 'todo')!.count });
    expect(folded.ids.length).toBe(open.ids.length - todo.count);
    expect(issuesOf(folded.ids).some(issue => issue.stateId === 'todo')).toBe(false);
    // Groups after the collapsed one start where their issues now are.
    const after = folded.groups[folded.groups.indexOf(todo) + 1]!;
    expect(byId.get(folded.ids[after.start]!)!.stateId).toBe(after.key);
  });

  it('puts "No assignee" and "No project" last', () => {
    expect(run({ group: 'assignee' }).groups.at(-1)!.label).toBe('No assignee');
    expect(run({ group: 'project' }).groups.at(-1)!.label).toBe('No project');
  });

  it('gives the same order every time', () => {
    expect(run({ sort: { field: 'updatedAt', direction: 'desc' } }).ids).toEqual(
      run({ sort: { field: 'updatedAt', direction: 'desc' } }).ids
    );
  });
});

/**
 * The fastest of a few runs. Load from the specs running beside this one
 * can only make a run slower, never faster, so the best run is the one
 * that says what the code costs.
 */
function fastest(run: () => void, times = 3): number {
  let best = Infinity;
  for (let i = 0; i < times; i++) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

describe('refining and dates', () => {
  it('needs both the screen’s filter and the refinement', () => {
    const result = run({ group: 'none', filter: { teamIds: ['web'] }, refine: { priorities: [1] } });
    const issues = issuesOf(result.ids);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(i => i.teamId === 'web' && i.priority === 1)).toBe(true);
  });

  it('needs every extra filter too, so a view’s own refinement and a new one both apply', () => {
    const result = run({ group: 'none', filter: {}, also: [{ labelIds: ['l0'] }], refine: { labelIds: ['l1'] } });
    const issues = issuesOf(result.ids);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(i => i.labelIds.includes('l0') && i.labelIds.includes('l1'))).toBe(true);
  });

  it('reads due dates against today, and leaves closed issues out of overdue', () => {
    const today = '2026-04-01';
    const due = (preset: 'overdue' | 'today' | 'week' | 'none') =>
      issuesOf(runQuery(small, small.issues, { ...DEFAULT_QUERY, group: 'none', filter: { due: preset } }, { today, now: Date.parse(`${today}T12:00:00Z`) }).ids);
    expect(due('overdue').every(i => i.dueDate! < today && i.stateId !== 'done')).toBe(true);
    expect(due('overdue').length).toBeGreaterThan(0);
    expect(due('week').every(i => i.dueDate! >= today && i.dueDate! <= '2026-04-08')).toBe(true);
    expect(due('none').every(i => i.dueDate === null)).toBe(true);
    expect(due('none').length + small.issues.filter(i => i.dueDate !== null).length).toBe(small.issues.length);
  });

  it('keeps what changed or was made within some days', () => {
    const now = Date.UTC(2026, 6, 1);
    const recent = issuesOf(runQuery(small, small.issues, { ...DEFAULT_QUERY, group: 'none', filter: { updatedWithin: 30 } }, { now }).ids);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every(i => i.updatedAt >= now - 30 * 86_400_000)).toBe(true);
  });
});

describe('the Phase 1 budget', () => {
  const big = seedWorkspace({ issues: 50_000 });

  it.each<[string, IssueQuery]>([
    ['the default: group by state, sort by priority', DEFAULT_QUERY],
    ['a text search', { ...DEFAULT_QUERY, filter: { text: 'export' } }],
    ['filtered, grouped by assignee, sorted by key', { filter: { stateIds: ['todo', 'in-progress'] }, sort: { field: 'key', direction: 'desc' }, group: 'assignee' }],
    ['no filter, sorted by title', { filter: {}, sort: { field: 'title', direction: 'asc' }, group: 'none' }]
  ])('runs %s over 50,000 issues in under 100 ms', (_name, query) => {
    runQuery(big, big.issues, query); // warm the search cache and the JIT, as a running worker would be
    expect(runQuery(big, big.issues, query).ids.length).toBeGreaterThan(0);
    expect(fastest(() => runQuery(big, big.issues, query))).toBeLessThan(100);
  });

  it('runs a full-text search through the index, combined with filters, in under 100 ms', () => {
    const store = new IssueStore(big, 1);
    const index = new SearchIndex(store);
    index.ensureBuilt();
    const query: IssueQuery = { filter: { text: 'search pag', stateIds: ['todo'], priorities: [1, 2] }, sort: { field: 'updatedAt', direction: 'desc' }, group: 'assignee' };
    const search = (text: string) => index.search(text);
    expect(runQuery(big, store.issues(), query, search).ids.length).toBeGreaterThan(0);
    expect(fastest(() => runQuery(big, store.issues(), query, search))).toBeLessThan(100);
  });
});
