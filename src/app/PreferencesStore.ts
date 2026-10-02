import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import type { TextStore } from '../model/persistence';
import { DEFAULT_PREFERENCES, type PreferencesView, type ThemeChoice } from './PreferencesContract';

const KEY = 'preferences-v1';
export const SPLIT_MIN = 0.12;
export const SPLIT_MAX = 0.4;

/** A person's preferences, in the app worker, saved beside the workspace overlay. */
export class PreferencesStore {
  readonly state = new BehaviorSubject<PreferencesView>(DEFAULT_PREFERENCES);
  readonly theme = this.field('theme');
  readonly sidebarSplit = this.field('sidebarSplit');
  readonly sidebarOpen = this.field('sidebarOpen');

  constructor(private readonly store: TextStore) {}

  private field<K extends keyof PreferencesView>(key: K) {
    return this.state.pipe(
      map(state => state[key]),
      distinctUntilChanged()
    );
  }

  async restore(): Promise<void> {
    const read = await this.store.read(KEY);
    if (read.outcome !== 'ok' || read.value === null) {
      return;
    }
    try {
      const saved = JSON.parse(read.value) as Partial<PreferencesView>;
      this.state.next({
        theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system',
        sidebarSplit: typeof saved.sidebarSplit === 'number' ? clampSplit(saved.sidebarSplit) : DEFAULT_PREFERENCES.sidebarSplit,
        sidebarOpen: saved.sidebarOpen !== false
      });
    } catch {
      // A record that will not parse is a record that is not there.
    }
  }

  setTheme(theme: ThemeChoice): void {
    this.write({ ...this.state.value, theme });
  }

  setSidebarSplit(split: number): void {
    this.write({ ...this.state.value, sidebarSplit: clampSplit(split) });
  }

  setSidebarOpen(open: boolean): void {
    this.write({ ...this.state.value, sidebarOpen: open });
  }

  private write(next: PreferencesView): void {
    this.state.next(next);
    void this.store.write(KEY, JSON.stringify(next));
  }
}

function clampSplit(split: number): number {
  return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, split));
}
