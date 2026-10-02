import type { Block } from './markdown';

/**
 * The editor's undo history, for the document as a whole.
 *
 * A document is many fields, and each field's own history knows only
 * its text: it can't undo a paragraph split, a join, a list nested with
 * Tab, or a heading made by typing `# `. So the editor keeps one history
 * of document states and cancels the fields' own (see
 * `text-editing-and-ime.md`, "Owning undo").
 *
 * Blocks are immutable, so a state is an array of references and costs
 * one array per entry, however long the document.
 *
 * Typing coalesces the way a text field's does: a run of characters in
 * one block is one step, until the person pauses, moves the caret, or
 * does anything else. A markdown shortcut is its own step after the
 * typing that triggered it, so undoing right after `# ` became a heading
 * gives back the `# ` that was typed.
 */

/** Where the caret is: a block and an offset in its text. */
export interface Caret {
  readonly id: string;
  readonly offset: number;
}

export interface DocumentState {
  readonly blocks: readonly Block[];
  readonly caret: Caret | null;
}

/**
 * What an edit was, for deciding whether it joins the step before it.
 * Only `typing` and `deleting` coalesce, and only with their own kind.
 */
export type EditKind = 'typing' | 'deleting' | 'structure' | 'shortcut' | 'format';

interface Entry {
  readonly before: DocumentState;
  after: DocumentState;
  readonly kind: EditKind;
  /** When the last edit in this entry happened, for coalescing. */
  at: number;
}

export interface HistoryOptions {
  /** A pause longer than this ends a run of typing. */
  readonly coalesceMs?: number;
  /** How many steps are kept. */
  readonly limit?: number;
  readonly now?: () => number;
}

export class DocumentHistory {
  private readonly done: Entry[] = [];
  private readonly undone: Entry[] = [];
  private readonly coalesceMs: number;
  private readonly limit: number;
  private readonly now: () => number;
  /** Set when the caret moves by itself, so the next character starts a new step. */
  private broken = true;

  constructor(options: HistoryOptions = {}) {
    this.coalesceMs = options.coalesceMs ?? 1000;
    this.limit = options.limit ?? 500;
    this.now = options.now ?? (() => Date.now());
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Records an edit from `before` to `after`. */
  record(before: DocumentState, after: DocumentState, kind: EditKind): void {
    const at = this.now();
    const last = this.done[this.done.length - 1];
    this.undone.length = 0;
    if (
      last !== undefined &&
      !this.broken &&
      (kind === 'typing' || kind === 'deleting') &&
      last.kind === kind &&
      at - last.at <= this.coalesceMs &&
      last.after.caret?.id === after.caret?.id &&
      last.after.blocks === before.blocks
    ) {
      last.after = after;
      last.at = at;
      return;
    }
    this.done.push({ before, after, kind, at });
    if (this.done.length > this.limit) {
      this.done.shift();
    }
    this.broken = false;
  }

  /** Ends the current run of typing: the caret moved, or focus left. */
  breakRun(): void {
    this.broken = true;
  }

  /** The state to go back to, or null when there's nothing to undo. */
  undo(): DocumentState | null {
    const entry = this.done.pop();
    if (entry === undefined) {
      return null;
    }
    this.undone.push(entry);
    this.broken = true;
    return entry.before;
  }

  /** The state to go forward to, or null when there's nothing to redo. */
  redo(): DocumentState | null {
    const entry = this.undone.pop();
    if (entry === undefined) {
      return null;
    }
    this.done.push(entry);
    this.broken = true;
    return entry.after;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this.broken = true;
  }
}
