import type { ChannelSource } from 'gesso-framework';

import type { PreferencesCommands, PreferencesView } from './PreferencesContract';
import type { PreferencesStore } from './PreferencesStore';

/**
 * The preferences channel, fed from the store.
 *
 * Typed against the contract, so a command the contract declares and
 * this forgets is a compile error rather than a press that does nothing:
 * `serveChannels` takes its sources erased, and checks a command only
 * when one is sent. The worker and the shell's specs both serve this,
 * so the specs press the buttons the app has.
 */
export function preferencesSource(preferences: PreferencesStore): ChannelSource<PreferencesView, PreferencesCommands> {
  return {
    view: {
      theme: preferences.theme,
      sidebarSplit: preferences.sidebarSplit,
      sidebarOpen: preferences.sidebarOpen,
      tourDone: preferences.tourDone
    },
    commands: {
      setTheme: theme => preferences.setTheme(theme),
      setSidebarSplit: split => preferences.setSidebarSplit(split),
      setSidebarOpen: open => preferences.setSidebarOpen(open),
      setTourDone: done => preferences.setTourDone(done)
    }
  };
}
