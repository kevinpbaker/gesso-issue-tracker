import { channel } from 'gesso-framework';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface PreferencesView {
  theme: ThemeChoice;
  /** Where the sidebar's divider sits, as a fraction of the window: `SplitPane`'s unit. */
  sidebarSplit: number;
  sidebarOpen: boolean;
}

/** A type rather than an interface: a channel's commands must index as a record. */
export type PreferencesCommands = {
  setTheme(theme: ThemeChoice): void;
  setSidebarSplit(split: number): void;
  setSidebarOpen(open: boolean): void;
};

export const DEFAULT_PREFERENCES: PreferencesView = { theme: 'system', sidebarSplit: 0.2, sidebarOpen: true };

export const Preferences = channel<PreferencesView, PreferencesCommands>('preferences', DEFAULT_PREFERENCES);
