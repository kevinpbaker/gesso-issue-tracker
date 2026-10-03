import { channel } from 'gesso-framework';

import type { Issue, Priority } from '../model/types';
import type { IssueQuery, QueryGroup } from '../model/query';

/**
 * The barrier between a list of issues and the workspace behind it.
 *
 * The render worker sends a query and the window it can see. The app
 * worker answers with three keys, split so each changes for its own
 * reason:
 *
 *  - `summary`: the total and the groups, which change when the query
 *    or the result's shape does;
 *  - `window`: list position to issue ID, for the visible rows only,
 *    which is all a re-sort changes;
 *  - `rows`: issue ID to display row, which an edit to one issue
 *    changes in one place, wherever that issue now sits.
 *
 * Keying rows by ID rather than position is what keeps a re-sort
 * cheap: the issues in view are mostly the same issues, so the differ
 * sends new positions and almost no new rows.
 */

export interface IssueRow {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly stateId: string;
  readonly stateName: string;
  readonly priority: number;
  readonly assigneeId: string | null;
  readonly assigneeName: string;
  readonly initials: string;
  readonly labels: readonly string[];
  readonly projectName: string;
  readonly updatedAt: number;
}

export interface IssuesSummary {
  readonly total: number;
  readonly groups: readonly QueryGroup[];
  /** How long the last query took in the app worker, for the proof strip. */
  readonly queryMs: number;
}

/**
 * One property set on some issues from the keyboard: a status, a
 * priority, an assignee (null for nobody), or a label, which comes off
 * when every one of them has it and goes on otherwise.
 */
export type TriageChange =
  | { readonly field: 'state'; readonly stateId: string }
  | { readonly field: 'priority'; readonly priority: Priority }
  | { readonly field: 'assignee'; readonly assigneeId: string | null }
  | { readonly field: 'label'; readonly labelId: string };

/** The last step through the history, for the undo toast. `serial` tells two steps with the same label apart. */
export interface ChangeNotice {
  readonly serial: number;
  readonly kind: 'do' | 'undo' | 'redo';
  readonly label: string;
}

export interface IssuesView {
  query: IssueQuery;
  summary: IssuesSummary;
  window: Readonly<Record<string, string>>;
  rows: Readonly<Record<string, IssueRow>>;
  /** Which of the issues in the window are selected. Only the window's, like `rows`. */
  selected: Readonly<Record<string, true>>;
  /** How many issues are selected in all, on screen or not. */
  selectedCount: number;
  undoLabel: string | null;
  /** What was last done, undone or redone, anywhere in the app; null after a reset, and for typing. */
  lastChange: ChangeNotice | null;
}

/** Inclusive ranges of positions in the current result, `[[0, 4], [9, 9]]`. */
export type Selection = readonly (readonly [number, number])[];

/** A type rather than an interface: a channel's commands must index as a record. */
export type IssuesCommands = {
  setQuery(query: IssueQuery): void;
  setWindow(range: { readonly start: number; readonly end: number }): void;
  update(request: { readonly ids: readonly string[]; readonly patch: Partial<Issue>; readonly label: string }): void;
  /**
   * Selects the issues at some positions of the current result. Ranges
   * rather than IDs, so selecting 5,000 rows with Shift sends two numbers
   * across the barrier, not 5,000 strings. The selection itself is kept
   * as IDs in the app worker, so it survives a re-sort: the issues stay
   * selected wherever an edit moves them.
   */
  select(request: { readonly ranges: Selection; readonly mode: 'replace' | 'add' | 'toggle' }): void;
  clearSelection(): void;
  /** One patch to every selected issue, as one transaction. */
  updateSelected(request: { readonly patch: Partial<Issue>; readonly label: string }): void;
  /** Adds a label to every selected issue, keeping the labels each already has. */
  addLabelToSelected(request: { readonly labelId: string; readonly label: string }): void;
  /**
   * One property to some issues (the selection, without `ids`) as one
   * transaction, named by the app worker: "Moved 12 issues to Done".
   */
  triage(request: { readonly ids?: readonly string[]; readonly change: TriageChange }): void;
  undo(): void;
  redo(): void;
  reset(): void;
};

export const Issues = channel<IssuesView, IssuesCommands>('issues', {
  query: { filter: {}, sort: { field: 'priority', direction: 'asc' }, group: 'state' },
  summary: { total: 0, groups: [], queryMs: 0 },
  window: {},
  rows: {},
  selected: {},
  selectedCount: 0,
  undoLabel: null,
  lastChange: null
});
