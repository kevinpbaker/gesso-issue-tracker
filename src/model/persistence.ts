import type { IssueStore } from './IssueStore';

/**
 * Remembers what changed, and lays it back over the seed on start.
 *
 * Only the overlay is stored, never the 50,000 seed issues, which the
 * seed regenerates byte for byte. So the record is as big as what
 * people did, and a reset is deleting one key.
 *
 * `TextStore` is the subset of Gesso's `StorageAdapter` this needs,
 * declared here so the model has no framework import: `IndexedDbStorage`
 * satisfies it in the worker and a map satisfies it in a spec.
 */

export interface TextStore {
  read(key: string): Promise<{ readonly outcome: string; readonly value: string | null }>;
  write(key: string, value: string): Promise<string>;
  remove(key: string): Promise<string>;
}

export type RestoreOutcome = 'restored' | 'empty' | 'rejected' | 'failed';

export const OVERLAY_KEY = 'workspace-overlay-v1';

export class OverlayPersistence {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: IssueStore | null = null;
  /** The last write's outcome, `'ok'` until something goes wrong. */
  lastOutcome = 'ok';

  constructor(
    private readonly store: TextStore,
    private readonly settleMs = 400,
    private readonly key = OVERLAY_KEY
  ) {}

  async restore(issues: IssueStore): Promise<RestoreOutcome> {
    const read = await this.store.read(this.key);
    if (read.outcome !== 'ok') {
      return 'failed';
    }
    if (read.value === null) {
      return 'empty';
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(read.value);
    } catch {
      return 'rejected';
    }
    return issues.importOverlay(parsed) ? 'restored' : 'rejected';
  }

  /** Saves after every change, once the changes stop for `settleMs`. */
  watch(issues: IssueStore): () => void {
    const subscription = issues.changes.subscribe(() => this.schedule(issues));
    return () => subscription.unsubscribe();
  }

  schedule(issues: IssueStore): void {
    this.pending = issues;
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.flush(), this.settleMs);
  }

  /** Writes now, for a tab that is closing. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const issues = this.pending;
    this.pending = null;
    if (issues !== null) {
      this.lastOutcome = await this.store.write(this.key, JSON.stringify(issues.exportOverlay()));
    }
  }

  async clear(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.lastOutcome = await this.store.remove(this.key);
  }
}
