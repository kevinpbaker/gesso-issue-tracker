import { of } from 'rxjs';

import type { ChannelSource } from 'gesso-framework';

import type { Workspace } from '../model/types';
import type { WorkspaceView } from './WorkspaceContract';

export function workspaceSource(workspace: Workspace, me: string): ChannelSource<WorkspaceView, Record<string, never>> {
  return {
    view: {
      teams: of(workspace.teams),
      states: of(workspace.states),
      users: of(workspace.users),
      labels: of(workspace.labels),
      projects: of(workspace.projects),
      me: of(me)
    },
    commands: {}
  };
}
