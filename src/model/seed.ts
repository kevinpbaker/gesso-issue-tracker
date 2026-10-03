import type { Comment, Issue, IssueRelation, Label, Priority, Project, Team, User, Workspace, WorkflowState } from './types';

/**
 * A deterministic workspace.
 *
 * The same seed always produces the same issues, byte for byte, so a
 * spec can name `WEB-17` and a screenshot stays a screenshot. Phase 1
 * replaces the word lists with hand-written templates; the shape and
 * the determinism stay.
 */

/** mulberry32: small, fast, and good enough for fake data. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STATES: readonly WorkflowState[] = [
  { id: 'backlog', name: 'Backlog', type: 'backlog' },
  { id: 'todo', name: 'Todo', type: 'unstarted' },
  { id: 'in-progress', name: 'In Progress', type: 'started' },
  { id: 'in-review', name: 'In Review', type: 'started' },
  { id: 'done', name: 'Done', type: 'completed' }
];

const TEAMS: readonly Team[] = [
  { id: 'web', key: 'WEB', name: 'Web' },
  { id: 'api', key: 'API', name: 'Platform API' },
  { id: 'mob', key: 'MOB', name: 'Mobile' },
  { id: 'ops', key: 'OPS', name: 'Operations' }
];

const PEOPLE = [
  'Ada Okafor',
  'Ben Larsen',
  'Chloé Martin',
  'Dev Patel',
  'Elif Yılmaz',
  'Felix Wagner',
  'Grace Kim',
  'Hiro Tanaka',
  'Isla Murray',
  'Jonas Berg',
  'Kemi Adeyemi',
  'Luca Rossi'
];

const PROJECT_NAMES = ['Q3 launch', 'Billing v2', 'Onboarding refresh', 'Search rewrite', 'Reliability'];

const REPLIES = [
  'I can reproduce this on main.',
  'Looks related to WEB-12, linking.',
  'Pushed a fix, needs **review**.',
  'Can we get a screenshot of the failure?',
  'This is blocked on the API change.',
  'Moved to next cycle, not enough time this week.',
  'Added a regression test in `search.spec.ts`.',
  'Confirmed fixed in staging.'
];

const LABELS = ['Bug', 'Feature', 'Improvement', 'Design', 'Performance', 'Accessibility', 'Security', 'Tech debt'];

const VERBS = ['Fix', 'Add', 'Remove', 'Refactor', 'Investigate', 'Speed up', 'Document', 'Redesign', 'Migrate', 'Test'];
const OBJECTS = [
  'the login redirect',
  'invoice PDF export',
  'search results paging',
  'the settings page',
  'webhook retries',
  'dark mode contrast',
  'CSV import',
  'the onboarding checklist',
  'notification batching',
  'rate limiting',
  'the billing dashboard',
  'image uploads',
  'keyboard shortcuts',
  'session timeout handling',
  'the audit log',
  'team invitations'
];
const QUALIFIERS = [
  '',
  'on Safari',
  'for large workspaces',
  'when offline',
  'after a timezone change',
  'on slow connections',
  'for admins',
  'in the mobile layout'
];

function pick<T>(next: () => number, from: readonly T[]): T {
  return from[Math.floor(next() * from.length)]!;
}

function description(next: () => number, title: string, users: readonly User[]): string {
  const who = pick(next, users).handle;
  const steps = 2 + Math.floor(next() * 3);
  const lines = [`## Context`, '', `${title}. Reported by @${who} after the last release.`, '', '## Steps', ''];
  for (let step = 1; step <= steps; step += 1) {
    lines.push(`${step}. ${pick(next, ['Open', 'Click', 'Wait for', 'Reload', 'Resize'])} ${pick(next, OBJECTS)}`);
  }
  lines.push('', '## Acceptance', '', '- [ ] Reproduced locally', '- [ ] Fix has a **regression test**', '- [x] Triaged');
  if (next() < 0.3) {
    lines.push('', '```ts', `const retries = ${1 + Math.floor(next() * 5)};`, '```');
  }
  return lines.join('\n');
}

export interface SeedOptions {
  readonly seed?: number;
  readonly issues?: number;
}

const ESTIMATES = [1, 2, 3, 5, 8];
const RELATION_KINDS: readonly IssueRelation['kind'][] = ['related', 'related', 'blocks', 'duplicates'];

/** A calendar date `days` after an epoch time, as `YYYY-MM-DD`. */
function dateAfter(time: number, days: number): string {
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

export function seedWorkspace({ seed = 1, issues = 50_000 }: SeedOptions = {}): Workspace {
  const next = random(seed);
  // Fields added after the first seed draw from a stream of their own, so
  // every issue the first stream made stays exactly as it was.
  const later = random(seed ^ 0x5eed);
  const users: User[] = PEOPLE.map((name, index) => ({
    id: `u${index}`,
    name,
    handle: name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')
  }));
  const labels: Label[] = LABELS.map((name, index) => ({ id: `l${index}`, name }));
  const counters = new Map<string, number>();
  const projects: Project[] = TEAMS.flatMap(team =>
    PROJECT_NAMES.slice(0, 3).map((name, index) => ({ id: `p-${team.id}-${index}`, name, teamId: team.id }))
  );
  const start = Date.UTC(2026, 0, 1);
  const list: Issue[] = [];
  const comments: Comment[] = [];
  const relations: IssueRelation[] = [];
  /** The next rank in each state: issues start in generation order, a gap of 1024 apart. */
  const ranks = new Map<string, number>();

  for (let index = 0; index < issues; index += 1) {
    const team = pick(next, TEAMS);
    const number = (counters.get(team.id) ?? 0) + 1;
    counters.set(team.id, number);
    const qualifier = pick(next, QUALIFIERS);
    const title = `${pick(next, VERBS)} ${pick(next, OBJECTS)}${qualifier === '' ? '' : ` ${qualifier}`}`;
    const createdAt = start + Math.floor(next() * 240) * 86_400_000;
    const labelCount = Math.floor(next() * 3);
    const labelIds = new Set<string>();
    for (let l = 0; l < labelCount; l += 1) {
      labelIds.add(pick(next, labels).id);
    }
    const stateId = pick(next, STATES).id;
    const rank = (ranks.get(stateId) ?? 0) + 1024;
    ranks.set(stateId, rank);
    const teamProjects = projects.filter(project => project.teamId === team.id);
    const estimate = later() < 0.6 ? pick(later, ESTIMATES) : null;
    const dueDate = later() < 0.2 ? dateAfter(createdAt, 7 + Math.floor(later() * 60)) : null;
    // A sub-issue of a recent issue in the same team that isn't one itself.
    let parentId: string | null = null;
    if (later() < 0.08) {
      for (let back = list.length - 1; back >= Math.max(0, list.length - 40); back -= 1) {
        const candidate = list[back]!;
        if (candidate.teamId === team.id && candidate.parentId === null) {
          parentId = candidate.id;
          break;
        }
      }
    }
    if (later() < 0.05 && list.length > 0) {
      relations.push({
        id: `r${relations.length}`,
        fromId: `i${index}`,
        toId: list[Math.floor(later() * list.length)]!.id,
        kind: pick(later, RELATION_KINDS)
      });
    }
    list.push({
      id: `i${index}`,
      key: `${team.key}-${number}`,
      teamId: team.id,
      projectId: next() < 0.3 ? null : pick(next, teamProjects).id,
      title,
      description: description(next, title, users),
      stateId,
      rank,
      priority: Math.floor(next() * 5) as Priority,
      assigneeId: next() < 0.15 ? null : pick(next, users).id,
      labelIds: [...labelIds],
      estimate,
      dueDate,
      parentId,
      createdAt,
      updatedAt: createdAt + Math.floor(next() * 30) * 86_400_000
    });
    const replies = Math.floor(next() * next() * 5);
    for (let reply = 0; reply < replies; reply += 1) {
      comments.push({
        id: `c${index}-${reply}`,
        issueId: `i${index}`,
        authorId: pick(next, users).id,
        body: pick(next, REPLIES),
        createdAt: createdAt + (reply + 1) * 3_600_000
      });
    }
  }

  return { teams: TEAMS, projects, states: STATES, users, labels, issues: list, comments, relations };
}
