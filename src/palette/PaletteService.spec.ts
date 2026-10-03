import { describe, expect, it } from 'vitest';

import { IssueStore } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';
import { PaletteService, RECENT } from './PaletteService';

const make = (issues = 300, recent: readonly string[] = []) => {
  const service = new PaletteService(new IssueStore(seedWorkspace({ issues })), () => recent);
  service.setCatalog([
    { id: 'new', label: 'New issue', group: 'Issues' },
    { id: 'status-done', label: 'Set status: Done', group: 'Selected issues' },
    { id: 'board', label: 'Go to the Web board', group: 'Navigation', keywords: 'kanban' }
  ]);
  return service;
};

describe('the palette in the app worker', () => {
  it('lists every command, in order, before anything is typed', () => {
    expect(make().rank('').map(item => item.id)).toEqual(['new', 'status-done', 'board']);
  });

  it('offers the issues opened lately first, newest first, besides the open one and any that are gone', () => {
    const recent = ['WEB-4', 'WEB-900', 'API-2', 'WEB-1', 'WEB-2', 'API-1', 'WEB-3', 'API-3'];
    const service = make(300, recent);
    service.setOpenIssue('web-1');
    const items = service.rank('');
    const offered = items.filter(item => item.group === 'Recent');
    expect(offered).toHaveLength(RECENT);
    expect(offered.map(item => item.id)).toEqual(['WEB-4', 'API-2', 'WEB-2', 'API-1', 'WEB-3']);
    expect(offered[0]).toMatchObject({ kind: 'issue', label: expect.stringMatching(/^WEB-4 \S/) });
    // Then the commands, as before.
    expect(items.slice(RECENT).map(item => item.id)).toEqual(['new', 'status-done', 'board']);
    // Off the issue's page, it's offered too.
    service.setOpenIssue(null);
    expect(service.rank('')[0]!.id).toBe('WEB-4');
  });

  it("doesn't offer recent issues once something is typed", () => {
    expect(make(300, ['WEB-4']).rank('web').some(item => item.group === 'Recent')).toBe(false);
  });

  it('ranks commands by fuzzy match, keywords included, and adds the issues that match', () => {
    const service = make();
    expect(service.rank('stdn')[0]).toMatchObject({ kind: 'command', id: 'status-done' });
    expect(service.rank('kanban')[0]!.id).toBe('board');
    const items = service.rank('login redirect');
    expect(items.some(item => item.kind === 'issue')).toBe(true);
  });

  it('puts issues first when a key is typed', () => {
    const items = make().rank('web-1');
    expect(items[0]).toMatchObject({ kind: 'issue' });
    expect(items[0]!.id.startsWith('WEB-1')).toBe(true);
  });

  it('answers the last query, saying which, inside a frame at 50,000 issues', () => {
    const service = make(50_000);
    service.rank('webhook');
    const started = performance.now();
    service.search('webhook retr safari');
    const elapsed = performance.now() - started;
    expect(service.results.value.asked).toBe('webhook retr safari');
    expect(service.results.value.items.filter(item => item.kind === 'issue')).toHaveLength(8);
    expect(elapsed).toBeLessThan(100);
  });
});
