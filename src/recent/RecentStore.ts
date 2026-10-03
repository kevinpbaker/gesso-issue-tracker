import { BehaviorSubject } from 'rxjs';

import type { TextStore } from '../model/persistence';

const KEY = 'recent-v1';
/**
 * How many are kept: more than the palette shows, so that leaving out
 * the issue that's open, or one that's gone, still leaves enough.
 */
export const RECENT_KEPT = 10;

/** The issues opened lately, in the app worker, saved beside the preferences. */
export class RecentStore {
  readonly keys = new BehaviorSubject<readonly string[]>([]);

  constructor(private readonly store: TextStore) {}

  async restore(): Promise<void> {
    const read = await this.store.read(KEY);
    if (read.outcome !== 'ok' || read.value === null) return;
    let saved: unknown;
    try {
      saved = JSON.parse(read.value);
    } catch {
      // A record that will not parse is a record that is not there.
      return;
    }
    if (!Array.isArray(saved)) return;
    // Anything opened while the record was being read is newer than it.
    const merged = dedupe([...this.keys.value, ...saved.filter((key): key is string => typeof key === 'string')]);
    this.keys.next(merged.slice(0, RECENT_KEPT));
  }

  viewed(key: string): void {
    if (this.keys.value[0] === key) return;
    this.write(dedupe([key, ...this.keys.value]).slice(0, RECENT_KEPT));
  }

  /** Forgets the issues that no longer exist. */
  prune(exists: (key: string) => boolean): void {
    const kept = this.keys.value.filter(exists);
    if (kept.length !== this.keys.value.length) this.write(kept);
  }

  private write(next: readonly string[]): void {
    this.keys.next(next);
    void this.store.write(KEY, JSON.stringify(next));
  }
}

function dedupe(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}
