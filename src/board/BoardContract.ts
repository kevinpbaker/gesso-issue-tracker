import { channel } from 'gesso-framework';

/**
 * The barrier between the board and the issues behind it.
 *
 * The board is a grid of cells: one column per workflow state, and,
 * with swimlanes on, one lane per assignee or project. Each cell is an
 * ordered list. The render worker never holds the issue set: it tells
 * the app worker which rows of each cell it can see (`setWindow`), and
 * the app worker publishes those rows and nothing else.
 *
 * `slots` is a map keyed `lane|state:index` rather than an array per
 * cell, for the reason gesso-sheets' Phase 0 measured: an array window
 * that scrolled has no common prefix or suffix with the last one, so the
 * differ sends every element, while a map keyed by position sends only
 * the keys that entered or left.
 */

export interface CardRow {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly priority: number;
  /** Two letters, or '' when unassigned. */
  readonly initials: string;
  readonly labels: readonly string[];
}

export interface ColumnRow {
  readonly id: string;
  readonly name: string;
  /** Issues in this state across every lane. */
  readonly count: number;
}

export type LaneField = 'none' | 'assignee' | 'project';

/** The one lane there is with swimlanes off. */
export const ALL_LANE = 'all';
/** The lane for issues with no assignee, or no project. */
export const NO_LANE = 'none';

export interface LaneRow {
  readonly key: string;
  readonly label: string;
  /** Issues in each state within this lane. */
  readonly counts: Readonly<Record<string, number>>;
  readonly total: number;
}

export interface BoardView {
  columns: readonly ColumnRow[];
  lanes: readonly LaneRow[];
  laneField: LaneField;
  slots: Readonly<Record<string, CardRow>>;
  /**
   * Per cell, bumped whenever what an index in that cell means changes,
   * for its `LazyColumn`'s `revision`. Per cell so that a drop
   * re-renders the cells it touched, not the whole board.
   */
  revisions: Readonly<Record<string, number>>;
}

export interface WindowRequest {
  readonly lane: string;
  readonly stateId: string;
  readonly start: number;
  readonly end: number;
}

export interface MoveRequest {
  readonly id: string;
  readonly lane: string;
  readonly stateId: string;
  /** Where it lands in the destination cell, counted before it is removed from its own. */
  readonly index: number;
}

/** A type rather than an interface: a channel's commands must index as a record. */
export type BoardCommands = {
  /** Show one team's issues, or every team's with null. */
  setTeam(teamId: string | null): void;
  setLanes(field: LaneField): void;
  setWindow(request: WindowRequest): void;
  move(request: MoveRequest): void;
  undo(): void;
};

export const Board = channel<BoardView, BoardCommands>('board', {
  columns: [],
  lanes: [],
  laneField: 'none',
  slots: {},
  revisions: {}
});

export function cellKey(lane: string, stateId: string): string {
  return `${lane}|${stateId}`;
}

export function slotKey(lane: string, stateId: string, index: number): string {
  return `${lane}|${stateId}:${index}`;
}
