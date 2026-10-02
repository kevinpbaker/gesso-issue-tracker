import { describe, expect, it } from 'vitest';

import { seedWorkspace } from './seed';

describe('the seed', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(seedWorkspace({ issues: 500 }))).toBe(JSON.stringify(seedWorkspace({ issues: 500 })));
  });

  it('changes with the seed number', () => {
    expect(seedWorkspace({ seed: 2, issues: 5 }).issues[0]!.title).not.toBe(
      seedWorkspace({ seed: 1, issues: 5 }).issues[0]!.title
    );
  });

  it('gives each team its own key sequence', () => {
    const { issues } = seedWorkspace({ issues: 500 });
    const web = issues.filter(issue => issue.teamId === 'web').map(issue => issue.key);
    expect(web.slice(0, 3)).toEqual(['WEB-1', 'WEB-2', 'WEB-3']);
    expect(new Set(issues.map(issue => issue.key)).size).toBe(issues.length);
  });

  it('writes markdown descriptions', () => {
    const [issue] = seedWorkspace({ issues: 1 }).issues;
    expect(issue!.description).toMatch(/^## Context/);
    expect(issue!.description).toContain('- [ ] Reproduced locally');
  });

  it('ranks each state in generation order, with room between', () => {
    const { issues } = seedWorkspace({ issues: 200 });
    const todo = issues.filter(issue => issue.stateId === 'todo').map(issue => issue.rank);
    expect(todo).toEqual([...todo].sort((a, b) => a - b));
    expect(todo[1]! - todo[0]!).toBe(1024);
  });

  it('puts projects in their own team and comments on real issues', () => {
    const workspace = seedWorkspace({ issues: 500 });
    const projects = new Map(workspace.projects.map(project => [project.id, project]));
    for (const issue of workspace.issues) {
      if (issue.projectId !== null) {
        expect(projects.get(issue.projectId)!.teamId).toBe(issue.teamId);
      }
    }
    const ids = new Set(workspace.issues.map(issue => issue.id));
    expect(workspace.comments.length).toBeGreaterThan(0);
    expect(workspace.comments.every(comment => ids.has(comment.issueId))).toBe(true);
  });
});
