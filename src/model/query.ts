import type { Issue, Workspace } from './types';

/**
 * Filter, sort and group issues.
 *
 * One pass to filter, one sort with the group as the leading key, and
 * one pass to cut the groups out of the sorted list. A group is then a
 * range of the result, which is what a virtualized list needs: row
 * 4,210 of the list is row 4,210 of `ids`, whatever the grouping.
 *
 * The budget is 100 ms for 50,000 issues in node, and `query.spec.ts`
 * enforces it. A query is plain data, so it can sit in a URL (Phase 8)
 * and cross the worker barrier unchanged.
 */

/** `'none'` stands for "no assignee" or "no project" wherever an ID is expected. */
export const NONE = 'none';

export interface IssueFilter {
  readonly teamIds?: readonly string[];
  readonly stateIds?: readonly string[];
  readonly assigneeIds?: readonly string[];
  readonly projectIds?: readonly string[];
  /** Matches an issue carrying any of these labels. */
  readonly labelIds?: readonly string[];
  readonly priorities?: readonly number[];
  /**
   * Words to find. With a search index (the app worker has one), every
   * word must start a word of the title, the description or a comment;
   * without one, the text is matched against the key and the title.
   */
  readonly text?: string;
  /**
   * Due dates, relative to today, so a view saved as "overdue" goes on
   * meaning overdue: past due and not closed; due today; due within the
   * next seven days; with no due date.
   */
  readonly due?: DuePreset;
  /** Updated within this many days. */
  readonly updatedWithin?: number;
  /** Created within this many days. */
  readonly createdWithin?: number;
}

export type DuePreset = 'overdue' | 'today' | 'week' | 'none';

export type SortField = 'rank' | 'priority' | 'updatedAt' | 'createdAt' | 'key' | 'title';
export type GroupField = 'none' | 'state' | 'assignee' | 'priority' | 'project' | 'team';

export interface IssueQuery {
  readonly filter: IssueFilter;
  readonly sort: { readonly field: SortField; readonly direction: 'asc' | 'desc' };
  readonly group: GroupField;
  /** Group keys whose issues are left out of `ids`; the group itself, and its count, stay. */
  readonly collapsed?: readonly string[];
  /**
   * A second filter an issue must also match: what a person narrowed a
   * screen down to, on top of the screen's own (its team, its project,
   * its view). Kept apart so it can live in the url and be cleared
   * without touching what the screen is.
   */
  readonly refine?: IssueFilter;
  /**
   * More filters an issue must also match. A saved view keeps the
   * refinement it was saved with here, so a refinement made on top of
   * the view narrows it further instead of replacing it.
   */
  readonly also?: readonly IssueFilter[];
}

/** What a query needs from the world around it: the text index, and what today is. */
export interface QueryContext {
  readonly search?: TextSearch;
  /** Now, in epoch milliseconds. */
  readonly now?: number;
  /** Today's date, `YYYY-MM-DD`, in the reader's time zone. */
  readonly today?: string;
}

export const DEFAULT_QUERY: IssueQuery = {
  filter: {},
  sort: { field: 'priority', direction: 'asc' },
  group: 'state'
};

export interface QueryGroup {
  readonly key: string;
  readonly label: string;
  /** Index of the group's first issue in `ids`. */
  readonly start: number;
  /** How many issues the group holds. */
  readonly count: number;
  /** How many of them are in `ids`: `count`, or 0 when the group is collapsed. */
  readonly shown: number;
  readonly collapsed: boolean;
}

export interface QueryResult {
  readonly ids: readonly string[];
  readonly groups: readonly QueryGroup[];
}

/** Priority 0 means "none" and sorts after Low, as it does in Linear. */
const PRIORITY_ORDER = [5, 1, 2, 3, 4];
const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

/** Lower-cased search text per issue. Issues are immutable, so an edit gets a fresh entry. */
const searchText = new WeakMap<Issue, string>();
function haystack(issue: Issue): string {
  let text = searchText.get(issue);
  if (text === undefined) {
    text = `${issue.key} ${issue.title}`.toLowerCase();
    searchText.set(issue, text);
  }
  return text;
}

/** Full-text search: the IDs of the issues matching some text, or null when the text has no words. */
export type TextSearch = (text: string) => ReadonlySet<string> | null;

function matcher(filter: IssueFilter, context: QueryContext, closed: ReadonlySet<string>): (issue: Issue) => boolean {
  const { search } = context;
  const set = (values: readonly (string | number)[] | undefined) =>
    values === undefined || values.length === 0 ? null : new Set<string | number>(values);
  const teams = set(filter.teamIds);
  const states = set(filter.stateIds);
  const assignees = set(filter.assigneeIds);
  const projects = set(filter.projectIds);
  const labels = set(filter.labelIds);
  const priorities = set(filter.priorities);
  const text = filter.text?.trim().toLowerCase() ?? '';
  const found = text === '' || search === undefined ? null : search(text);
  const now = context.now ?? Date.now();
  const today = context.today ?? new Date(now).toISOString().slice(0, 10);
  const weekOut = addDays(today, 7);
  const due = filter.due;
  const dueMatches = (issue: Issue): boolean => {
    switch (due) {
      case undefined:
        return true;
      case 'none':
        return issue.dueDate === null;
      case 'overdue':
        return issue.dueDate !== null && issue.dueDate < today && !closed.has(issue.stateId);
      case 'today':
        return issue.dueDate === today;
      case 'week':
        return issue.dueDate !== null && issue.dueDate >= today && issue.dueDate <= weekOut;
    }
  };
  const updatedSince = filter.updatedWithin === undefined ? -Infinity : now - filter.updatedWithin * 86_400_000;
  const createdSince = filter.createdWithin === undefined ? -Infinity : now - filter.createdWithin * 86_400_000;

  return issue =>
    (teams === null || teams.has(issue.teamId)) &&
    (states === null || states.has(issue.stateId)) &&
    (assignees === null || assignees.has(issue.assigneeId ?? NONE)) &&
    (projects === null || projects.has(issue.projectId ?? NONE)) &&
    (priorities === null || priorities.has(issue.priority)) &&
    (labels === null || issue.labelIds.some(id => labels.has(id))) &&
    (text === '' || (found !== null ? found.has(issue.id) : search === undefined && haystack(issue).includes(text))) &&
    dueMatches(issue) &&
    issue.updatedAt >= updatedSince &&
    issue.createdAt >= createdSince;
}

interface Grouping {
  /** A sortable position for the group, so groups come out in a fixed order. */
  readonly order: (issue: Issue) => number;
  readonly key: (issue: Issue) => string;
  readonly label: (key: string) => string;
}

function grouping(field: GroupField, workspace: Workspace): Grouping | null {
  const indexOf = <T extends { id: string }>(list: readonly T[]) => new Map(list.map((item, index) => [item.id, index]));
  const nameOf = <T extends { id: string; name: string }>(list: readonly T[]) => new Map(list.map(item => [item.id, item.name]));

  switch (field) {
    case 'none':
      return null;
    case 'state': {
      const order = indexOf(workspace.states);
      const names = nameOf(workspace.states);
      return { order: i => order.get(i.stateId) ?? 999, key: i => i.stateId, label: key => names.get(key) ?? key };
    }
    case 'team': {
      const order = indexOf(workspace.teams);
      const names = nameOf(workspace.teams);
      return { order: i => order.get(i.teamId) ?? 999, key: i => i.teamId, label: key => names.get(key) ?? key };
    }
    case 'priority':
      return {
        order: i => PRIORITY_ORDER[i.priority]!,
        key: i => String(i.priority),
        label: key => PRIORITY_LABELS[Number(key)] ?? key
      };
    case 'assignee': {
      const sorted = [...workspace.users].sort((a, b) => a.name.localeCompare(b.name));
      const order = indexOf(sorted);
      const names = nameOf(workspace.users);
      return {
        order: i => (i.assigneeId === null ? 9999 : (order.get(i.assigneeId) ?? 9998)),
        key: i => i.assigneeId ?? NONE,
        label: key => (key === NONE ? 'No assignee' : (names.get(key) ?? key))
      };
    }
    case 'project': {
      const sorted = [...workspace.projects].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const order = indexOf(sorted);
      const names = nameOf(workspace.projects);
      return {
        order: i => (i.projectId === null ? 9999 : (order.get(i.projectId) ?? 9998)),
        key: i => i.projectId ?? NONE,
        label: key => (key === NONE ? 'No project' : (names.get(key) ?? key))
      };
    }
  }
}

/** `WEB-1042` sorts by team key, then numerically. */
function keyParts(key: string): [string, number] {
  const dash = key.lastIndexOf('-');
  return [key.slice(0, dash), Number(key.slice(dash + 1))];
}

function comparator(field: SortField): (a: Issue, b: Issue) => number {
  switch (field) {
    case 'rank':
      return (a, b) => a.rank - b.rank;
    case 'priority':
      return (a, b) => PRIORITY_ORDER[a.priority]! - PRIORITY_ORDER[b.priority]!;
    case 'updatedAt':
      return (a, b) => a.updatedAt - b.updatedAt;
    case 'createdAt':
      return (a, b) => a.createdAt - b.createdAt;
    case 'title':
      return (a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
    case 'key':
      return (a, b) => {
        const [ta, na] = keyParts(a.key);
        const [tb, nb] = keyParts(b.key);
        return ta < tb ? -1 : ta > tb ? 1 : na - nb;
      };
  }
}

export function runQuery(workspace: Workspace, issues: Iterable<Issue>, query: IssueQuery, context: QueryContext | TextSearch = {}): QueryResult {
  const world: QueryContext = typeof context === 'function' ? { search: context } : context;
  const closed = new Set(workspace.states.filter(state => state.type === 'completed' || state.type === 'canceled').map(state => state.id));
  const all = [query.filter, ...(query.also ?? []), ...(query.refine === undefined ? [] : [query.refine])].map(filter =>
    matcher(filter, world, closed)
  );
  const matches = all.length === 1 ? all[0]! : (issue: Issue) => all.every(match => match(issue));
  const group = grouping(query.group, workspace);
  const compare = comparator(query.sort.field);
  const sign = query.sort.direction === 'asc' ? 1 : -1;

  // Decorate once, so the sort compares numbers instead of calling the
  // group's map lookups n log n times.
  const rows: { issue: Issue; group: number; key: string }[] = [];
  for (const issue of issues) {
    if (matches(issue)) {
      rows.push({ issue, group: group === null ? 0 : group.order(issue), key: group === null ? '' : group.key(issue) });
    }
  }

  rows.sort(
    (a, b) =>
      a.group - b.group ||
      // Two groups the workspace does not know share an order; keep them apart.
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
      sign * compare(a.issue, b.issue) ||
      // A stable, total order, so equal issues never trade places between runs.
      (a.issue.id < b.issue.id ? -1 : a.issue.id > b.issue.id ? 1 : 0)
  );

  const collapsed = new Set(query.collapsed ?? []);
  const ids: string[] = [];
  const groups: QueryGroup[] = [];
  if (group !== null) {
    let from = 0;
    while (from < rows.length) {
      const key = rows[from]!.key;
      let to = from + 1;
      while (to < rows.length && rows[to]!.key === key) {
        to += 1;
      }
      const folded = collapsed.has(key);
      groups.push({ key, label: group.label(key), start: ids.length, count: to - from, shown: folded ? 0 : to - from, collapsed: folded });
      if (!folded) {
        for (let index = from; index < to; index += 1) ids.push(rows[index]!.issue.id);
      }
      from = to;
    }
  } else {
    for (const row of rows) ids.push(row.issue.id);
    if (rows.length > 0) {
      groups.push({ key: 'all', label: 'All issues', start: 0, count: rows.length, shown: rows.length, collapsed: false });
    }
  }

  return { ids, groups };
}

/** A `YYYY-MM-DD` date some days on. */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
