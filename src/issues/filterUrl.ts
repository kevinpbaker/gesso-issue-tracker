import type { DuePreset, IssueFilter } from '../model/query';

/**
 * A filter as a url's query, and back.
 *
 * `?status=todo,in-progress&assignee=u1,none&q=login loop&due=overdue`
 *
 * Every dimension is its own parameter, its values joined by commas, so
 * a link reads as what it filters and survives being edited by hand.
 * The router owns the encoding: it hands over the query decoded, as a
 * record, and encodes what it's given. A value the workspace doesn't
 * know is kept: the filter matches nothing for it, which is what such a
 * link means.
 */

export type UrlQuery = Readonly<Record<string, string>>;

const LISTS = {
  team: 'teamIds',
  status: 'stateIds',
  assignee: 'assigneeIds',
  project: 'projectIds',
  label: 'labelIds'
} as const;

const DUE: readonly DuePreset[] = ['overdue', 'today', 'week', 'none'];

export function filterToQuery(filter: IssueFilter): Record<string, string> {
  const query: Record<string, string> = {};
  if (filter.text !== undefined && filter.text.trim() !== '') query.q = filter.text;
  for (const [name, key] of Object.entries(LISTS)) {
    const values = filter[key] ?? [];
    if (values.length > 0) query[name] = values.join(',');
  }
  if ((filter.priorities?.length ?? 0) > 0) query.priority = filter.priorities!.join(',');
  if (filter.due !== undefined) query.due = filter.due;
  if (filter.updatedWithin !== undefined) query.updated = String(filter.updatedWithin);
  if (filter.createdWithin !== undefined) query.created = String(filter.createdWithin);
  return query;
}

export function filterFromQuery(query: UrlQuery): IssueFilter {
  const list = (name: string) => (query[name] ?? '').split(',').filter(value => value !== '');
  const filter: Record<string, unknown> = {};
  if ((query.q ?? '').trim() !== '') filter.text = query.q;
  for (const [name, key] of Object.entries(LISTS)) {
    const values = list(name);
    if (values.length > 0) filter[key] = values;
  }
  const priorities = list('priority').map(Number).filter(p => Number.isInteger(p) && p >= 0 && p <= 4);
  if (priorities.length > 0) filter.priorities = priorities;
  if ((DUE as readonly string[]).includes(query.due ?? '')) filter.due = query.due;
  for (const [name, key] of [['updated', 'updatedWithin'], ['created', 'createdWithin']] as const) {
    const days = Number(query[name]);
    if (Number.isFinite(days) && days > 0) filter[key] = days;
  }
  return filter as IssueFilter;
}

/** Whether a filter narrows anything. */
export function isEmptyFilter(filter: IssueFilter): boolean {
  return Object.keys(filterToQuery(filter)).length === 0;
}
