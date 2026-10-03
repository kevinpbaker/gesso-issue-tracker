import { channel } from 'gesso-framework';

import type { Priority } from '../model/types';

/**
 * Filing a new issue: the draft being written, and the command that
 * files it.
 *
 * The draft lives in the app worker and is saved beside the workspace,
 * so a half-written issue survives closing the dialog and reloading
 * the page. The dialog writes it as it changes and reads it when it
 * opens.
 */

export interface Draft {
  readonly title: string;
  /** Markdown. */
  readonly description: string;
  readonly teamId: string;
  readonly stateId: string;
  readonly priority: Priority;
  /** '' for nobody. */
  readonly assigneeId: string;
  readonly labelIds: readonly string[];
  /** Whether the dialog stays open after filing, for the next one. */
  readonly createMore: boolean;
}

export const EMPTY_DRAFT: Draft = {
  title: '',
  description: '',
  teamId: 'web',
  stateId: 'todo',
  priority: 0,
  assigneeId: '',
  labelIds: [],
  createMore: false
};

/** The issue just filed, so the page can say so and link to it. */
export interface Filed {
  readonly key: string;
  readonly title: string;
  /** Counts up with every issue filed, so filing the same title twice is still news. */
  readonly serial: number;
}

export interface ComposeView {
  /** The saved draft, or null before it has been read from disk. */
  draft: Draft | null;
  filed: Filed | null;
}

export type ComposeCommands = {
  /** Saves the draft as it is now. */
  save(draft: Draft): void;
  /**
   * Files the draft as an issue. The draft that's kept afterwards is
   * empty, or, with "Create more", keeps everything but the title and
   * description, for the next issue in a row.
   */
  file(draft: Draft): void;
  /** Throws the draft away. */
  discard(): void;
};

export const Compose = channel<ComposeView, ComposeCommands>('compose', { draft: null, filed: null });
