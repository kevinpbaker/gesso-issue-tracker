import type { ChannelSource } from 'gesso-framework';

import type { RecentCommands, RecentView } from './RecentContract';
import type { RecentStore } from './RecentStore';

/** The recent issues channel, fed from the store: what the app worker serves, and what a spec does. */
export function recentSource(recent: RecentStore): ChannelSource<RecentView, RecentCommands> {
  return {
    view: { keys: recent.keys },
    commands: { viewed: key => recent.viewed(key) }
  };
}
