import { describe, expect, it } from 'vitest';

import { IssueStore } from '../model/IssueStore';
import { DEFAULT_QUERY, runQuery } from '../model/query';
import { seedWorkspace } from '../model/seed';
import { SearchIndex, tokenize } from './SearchIndex';

const make = (issues = 300) => {
  const store = new IssueStore(seedWorkspace({ issues }), 1, () => 1);
  return { store, index: new SearchIndex(store) };
};

describe('tokenize', () => {
  it('lower-cases, drops accents and splits on everything else', () => {
    expect(tokenize('Élif’s **regression** test, WEB-12!')).toEqual(['elif', 's', 'regression', 'test', 'web', '12']);
  });
});

describe('the search index', () => {
  it('finds words in titles, descriptions and comments, each as a prefix', () => {
    const { store, index } = make();
    const issue = store.get('i5')!;
    const titleWord = tokenize(issue.title)[1]!;
    expect(index.search(titleWord.slice(0, 3))!.has('i5')).toBe(true);
    store.update(['i5'], { description: 'The flamingo crashed the parser' }, 'Edit');
    expect([...index.search('flamin')!]).toEqual(['i5']);
    store.comment({ id: 'cx', issueId: 'i6', authorId: 'u1', body: 'Seen on a quokka build', createdAt: 2 });
    expect([...index.search('quokka')!]).toEqual(['i6']);
    // Every word has to match.
    expect([...index.search('flamingo parser')!]).toEqual(['i5']);
    expect(index.search('flamingo quokka')!.size).toBe(0);
    expect(index.search('  ')).toBeNull();
  });

  it('forgets what an edit took away, and an issue that was deleted', () => {
    const { store, index } = make();
    store.update(['i5'], { description: 'zebra' }, 'Edit');
    expect(index.search('zebra')!.has('i5')).toBe(true);
    store.update(['i5'], { description: 'giraffe' }, 'Edit');
    expect(index.search('zebra')!.has('i5')).toBe(false);
    store.undo();
    expect(index.search('zebra')!.has('i5')).toBe(true);
    const issue = store.newIssue({ teamId: 'web', title: 'Narwhal sighting', description: '', stateId: 'todo', priority: 0, assigneeId: null, labelIds: [] });
    store.create(issue);
    expect([...index.search('narwhal')!]).toEqual([issue.id]);
    store.undo();
    expect(index.search('narwhal')!.size).toBe(0);
  });

  it('finds an issue by its key', () => {
    const { index } = make();
    expect(index.search('web-1')!.size).toBeGreaterThan(0);
    const key = make().store.get('i9')!.key.toLowerCase();
    expect(index.search(key)!.has('i9')).toBe(true);
  });

  it('serves a text filter through a query', () => {
    const { store, index } = make();
    store.update(['i3', 'i8'], { description: 'Mentions the okapi incident' }, 'Edit');
    const result = runQuery(store.workspace, store.issues(), { ...DEFAULT_QUERY, group: 'none', filter: { text: 'okapi' } }, text => index.search(text));
    expect([...result.ids].sort()).toEqual(['i3', 'i8']);
  });

  it('builds in slices, keeps up with edits made mid-build, and lets a search finish it', () => {
    const { store, index } = make();
    const queued: (() => void)[] = [];
    index.warm(100, next => queued.push(next));
    queued.shift()!();
    // An edit to an issue already indexed, and one to an issue not yet reached.
    store.update(['i5', 'i250'], { description: 'wombat' }, 'Edit');
    queued.shift()!();
    expect([...index.search('wombat')!].sort()).toEqual(['i250', 'i5']);
    // The search finished the build; the next slice has nothing to do.
    queued.shift()?.();
    expect(index.search('wombat')!.size).toBe(2);
  });

  it('builds over 50,000 issues and answers a search inside the budget', () => {
    const { index } = make(50_000);
    const started = performance.now();
    index.ensureBuilt();
    const built = performance.now() - started;
    const searched = performance.now();
    const found = index.search('search pag');
    const answered = performance.now() - searched;
    expect(found!.size).toBeGreaterThan(0);
    // Generous for a loaded CI machine; in the worker it's well under.
    expect(built).toBeLessThan(4_000);
    expect(answered).toBeLessThan(100);
  });
});
