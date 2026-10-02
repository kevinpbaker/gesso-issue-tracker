import { channel } from 'gesso-framework';

import type { Label, Project, Team, User, WorkflowState } from '../model/types';

/**
 * The workspace's fixed vocabulary: teams, states, people, labels and
 * projects. Sent once and never patched in Phase 2, so every screen can
 * name things without the render worker bundling the seed.
 */
export interface WorkspaceView {
  teams: readonly Team[];
  states: readonly WorkflowState[];
  users: readonly User[];
  labels: readonly Label[];
  projects: readonly Project[];
  /** Who "me" is. There is no sign-in; see the roadmap. */
  me: string;
}

export const WorkspaceMeta = channel<WorkspaceView, Record<string, never>>('workspace', {
  teams: [],
  states: [],
  users: [],
  labels: [],
  projects: [],
  me: 'u0'
});
