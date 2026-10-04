import { describe, expect, it } from 'vitest';

import { IssueStore } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';
import { FOUND, ReferenceService } from './ReferenceService';

/**
 * The app worker's half of an issue reference typed in the editor:
 * `WEB-` and what follows it, matched against the workspace's issues.
 */
const make = (issues = 400) => {
  const store = new IssueStore(seedWorkspace({ issues }), 1);
  return { store, service: new ReferenceService(store) };
};

describe('issue references in the app worker', () => {
  it('finds by number, the key typed first and then the keys it starts, in order', () => {
    const { service } = make(4000);
    const keys = service.match('WEB', '1').map(found => found.key);
    expect(keys).toEqual(['WEB-1', 'WEB-10', 'WEB-11', 'WEB-12', 'WEB-13', 'WEB-14', 'WEB-15', 'WEB-16']);
    expect(service.match('WEB', '10').map(found => found.key)).toEqual(['WEB-10', 'WEB-100', 'WEB-101', 'WEB-102', 'WEB-103', 'WEB-104', 'WEB-105', 'WEB-106']);
  });

  it("stops at the team's last number, so a short team answers quickly and fully", () => {
    const { store, service } = make(40);
    const team = store.workspace.teams.find(t => t.key === 'WEB')!;
    const last = store.lastNumberOf(team.id);
    expect(last).toBeGreaterThan(0);
    expect(service.match('WEB', String(last)).map(found => found.key)).toEqual([`WEB-${last}`]);
    expect(service.match('WEB', String(last + 1))).toEqual([]);
    expect(service.match('WEB', '0')).toEqual([]);
  });

  it("finds by title within the key's team, and the latest touched with nothing typed", () => {
    const { store, service } = make();
    const issue = [...store.issues()].find(i => i.key.startsWith('API-'))!;
    const word = issue.title.split(' ')[0]!;
    const found = service.match('API', word);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(FOUND);
    expect(found.every(f => f.key.startsWith('API-'))).toBe(true);
    expect(found.map(f => f.key)).toContain(issue.key);

    const latest = service.match('API', '');
    const team = [...store.issues()].filter(i => i.key.startsWith('API-')).sort((a, b) => b.updatedAt - a.updatedAt);
    expect(latest.map(f => f.key)).toEqual(team.slice(0, FOUND).map(i => i.key));
  });

  it('knows no team by another key, and answers with the question it was asked', () => {
    const { service } = make();
    expect(service.match('XYZ', '1')).toEqual([]);
    service.find('WEB', '12');
    expect(service.found.value).toEqual({ asked: 'WEB-12', issues: [expect.objectContaining({ key: 'WEB-12' })] });
  });
});
