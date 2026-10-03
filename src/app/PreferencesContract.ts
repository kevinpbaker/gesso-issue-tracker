import { channel } from 'gesso-framework';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface PreferencesView {
  theme: ThemeChoice;
  /** Where the sidebar's divider sits, as a fraction of the window: `SplitPane`'s unit. */
  sidebarSplit: number;
  sidebarOpen: boolean;
  /**
   * Whether the guided tour has been finished or put away. Null until
   * the saved preferences are read, so the tour doesn't flash up for
   * someone who has already done it.
   */
  tourDone: boolean | null;
}

/** A type rather than an interface: a channel's commands must index as a record. */
export type PreferencesCommands = {
  setTheme(theme: ThemeChoice): void;
  setSidebarSplit(split: number): void;
  setSidebarOpen(open: boolean): void;
  setTourDone(done: boolean): void;
};

export const DEFAULT_PREFERENCES: PreferencesView = { theme: 'system', sidebarSplit: 0.2, sidebarOpen: true, tourDone: null };

export const Preferences = channel<PreferencesView, PreferencesCommands>('preferences', DEFAULT_PREFERENCES);
