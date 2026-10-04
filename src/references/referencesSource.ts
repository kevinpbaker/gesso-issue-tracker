import type { ChannelSource } from 'gesso-framework';

import type { ReferencesCommands, ReferencesView } from './ReferencesContract';
import type { ReferenceService } from './ReferenceService';

/** The references channel, served from the service: what the app worker serves, and what a spec does. */
export function referencesSource(references: ReferenceService): ChannelSource<ReferencesView, ReferencesCommands> {
  return {
    view: { found: references.found },
    commands: { find: ({ prefix, query }) => references.find(prefix, query) }
  };
}
