import { channel } from 'gesso-framework';

import type { IssueQuery } from '../model/query';

/**
 * The barrier between the issue page's j and k and the list behind them.
 *
 * The issue page names the lists it could be stepping through, the one
 * it came from first and the issue's team list last, and the app worker
 * answers where the issue sits in the first of them that has it: its
 * position, the count, and the keys either side. The answer follows
 * every change, so an edit that re-sorts the list moves the neighbours
 * with it, and an edit that takes the issue out of the list leaves the
 * neighbours it had.
 */

/** What can be stepped through: a list, by its query exactly as the list ran it, or the board as it was left. */
export type StepList = { readonly kind: 'list'; readonly query: IssueQuery } | { readonly kind: 'board' };

export interface StepPosition {
  /** The key asked about, so an answer about the last issue is told apart. */
  readonly key: string;
  /** Which of the lists asked about the issue is counted in. */
  readonly list: number;
  /** Its position in that list, or where it was last when an edit has since taken it out. */
  readonly index: number;
  /** Whether it's still in the list. */
  readonly within: boolean;
  readonly total: number;
  readonly previous: string | null;
  readonly next: string | null;
  /** On the board, the card's cell and row, for the board's cursor to come back to. */
  readonly spot: { readonly lane: string; readonly stateId: string; readonly index: number } | null;
}

export interface StepsView {
  at: StepPosition | null;
}

/** A type rather than an interface: a channel's commands must index as a record. */
export type StepsCommands = {
  /** Where `key` is in the first of `lists` that has it, kept up to date until the next `follow` or `stop`. */
  follow(request: { readonly key: string; readonly lists: readonly StepList[] }): void;
  stop(): void;
};

export const Steps = channel<StepsView, StepsCommands>('steps', { at: null });
