import { describe, expect, it } from 'vitest';

import { IssueStore } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';
import { PaletteService } from './PaletteService';

const make = (issues = 300) => {
  const service = new PaletteService(new IssueStore(seedWorkspace({ issues })));
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
