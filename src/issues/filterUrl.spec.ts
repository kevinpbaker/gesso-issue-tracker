import { describe, expect, it } from 'vitest';

import type { IssueFilter } from '../model/query';
import { filterFromQuery, filterToQuery, isEmptyFilter } from './filterUrl';

describe('a filter in the url', () => {
  it('reads as what it filters, and reads back the same', () => {
    const filter: IssueFilter = {
      text: 'login, loop & more',
      stateIds: ['todo', 'in-progress'],
      assigneeIds: ['u1', 'none'],
      labelIds: ['l2'],
      priorities: [1, 2],
      due: 'overdue',
      updatedWithin: 7
    };
    const query = filterToQuery(filter);
    expect(query).toEqual({ q: 'login, loop & more', status: 'todo,in-progress', assignee: 'u1,none', label: 'l2', priority: '1,2', due: 'overdue', updated: '7' });
    expect(filterFromQuery(query)).toEqual(filter);
  });

  it('ignores what it cannot read, and keeps values it does not know', () => {
    expect(filterFromQuery({ priority: '9,x,2', due: 'someday', updated: '-3', status: 'nope', junk: '' })).toEqual({ priorities: [2], stateIds: ['nope'] });
  });

  it('is empty when it narrows nothing', () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ text: '   ', stateIds: [] })).toBe(true);
    expect(isEmptyFilter({ due: 'none' })).toBe(false);
  });
});
