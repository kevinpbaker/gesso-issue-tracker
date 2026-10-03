import { channel } from 'gesso-framework';

/**
 * The command palette's matching, in the app worker.
 *
 * The render worker holds the commands (each runs a function, which
 * can't cross the barrier), so it sends their names: the catalog, once
 * when the palette opens, with the issue open then, if any. Then each
 * query, as it's typed. The app worker ranks the catalog and the
 * workspace's issues against it and answers with the best of each; with
 * nothing typed, the issues opened lately and then the catalog.
 */

export interface CatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  /** Other words it answers to. */
  readonly keywords?: string;
}

export interface PaletteItem {
  readonly kind: 'command' | 'issue';
  /** A command's id, or an issue's key. */
  readonly id: string;
  readonly label: string;
  readonly group: string;
}

export interface PaletteView {
  /** The answer to the last query, and the query it answers, so a stale one can be told apart. */
  results: { readonly asked: string; readonly items: readonly PaletteItem[] };
}

export type PaletteCommands = {
  setCatalog(entries: readonly CatalogEntry[]): void;
  /** The issue open on its page as the palette opened, which isn't offered as a recent one; null on other screens. */
  setOpenIssue(key: string | null): void;
  search(query: string): void;
};

export const Palette = channel<PaletteView, PaletteCommands>('palette', { results: { asked: '', items: [] } });
