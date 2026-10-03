import { channel } from 'gesso-framework';

import type { IssueQuery } from '../model/query';

/**
 * Views people saved: a name for a filter, a sort and a grouping.
 *
 * A view keeps the whole query it was saved from, the screen's own
 * filter and the refinement on top, so opening it shows the same list
 * wherever it was made. Kept in the app worker and on disk.
 */

export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly query: IssueQuery;
}

export interface ViewsView {
  views: readonly SavedView[];
  /** The view just saved, so the page can open it. */
  saved: { readonly id: string; readonly serial: number } | null;
}

export type ViewsCommands = {
  save(request: { readonly name: string; readonly query: IssueQuery }): void;
  rename(request: { readonly id: string; readonly name: string }): void;
  remove(id: string): void;
};

export const Views = channel<ViewsView, ViewsCommands>('views', { views: [], saved: null });
