import { channel } from 'gesso-framework';

/**
 * Issues to reference from the editor, matched in the app worker.
 *
 * Typing a team's key and a dash in a description or a comment (`WEB-`)
 * opens a list of that team's issues, narrowed by what's typed after
 * it. The render worker never holds the workspace's 50,000 issues, so
 * each query is sent here and the best few come back, with the query
 * they answer so a stale one can be told apart.
 */

export interface IssueReference {
  readonly key: string;
  readonly title: string;
}

export interface ReferencesView {
  found: { readonly asked: string; readonly issues: readonly IssueReference[] };
}

export type ReferencesCommands = {
  /** The issues of the team keyed `prefix` matching `query`: a number for keys, words for titles, nothing for the latest. */
  find(ask: { readonly prefix: string; readonly query: string }): void;
};

/** How an answer names its question: the prefix and the query, as typed. */
export const askedFor = (prefix: string, query: string): string => `${prefix}-${query}`;

export const References = channel<ReferencesView, ReferencesCommands>('references', { found: { asked: '', issues: [] } });
