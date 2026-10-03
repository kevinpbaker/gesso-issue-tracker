import { channel } from 'gesso-framework';

/**
 * The issues a person opened lately, newest first: the palette offers
 * them before anything is typed. Kept in the app worker and on disk,
 * beside the preferences but under a key of their own.
 */

export interface RecentView {
  /** Issue keys, newest first, each once. */
  keys: readonly string[];
}

export type RecentCommands = {
  /** The issue page opened this issue. */
  viewed(key: string): void;
};

export const Recent = channel<RecentView, RecentCommands>('recent', { keys: [] });
