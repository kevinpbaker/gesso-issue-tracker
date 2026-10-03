import type { WorkspaceView } from '../app/WorkspaceContract';
import { PRIORITY_NAMES, type Issue, type Priority } from '../model/types';
import type { CopyWhat } from '../app/copyIssue';
import type { PaletteCommand } from './CommandsService';

/** The label of the command, and of its shortcut, so the palette lists the two as one. */
export const COPY_LINK = 'Copy link';

/** Copying an issue's link or its key, for whichever issue the caller means. */
export function copyCommands(group: string, copy: (what: CopyWhat) => void): PaletteCommand[] {
  return [
    { id: `${group}:copy-link`, label: COPY_LINK, group, keywords: 'url address share clipboard', run: () => copy('link') },
    { id: `${group}:copy-key`, label: 'Copy key', group, keywords: 'id identifier clipboard', run: () => copy('key') }
  ];
}

/**
 * The commands that change issues' properties: every status, priority,
 * person and label, as "Set status: Done", "Assign to Ada Okafor", and
 * so on. The same list for the issues selected in a list and for the
 * issue open on its page; what they apply to is the caller's.
 */
export function propertyCommands(
  meta: Pick<WorkspaceView, 'states' | 'users' | 'labels'>,
  group: string,
  apply: { readonly update: (patch: Partial<Issue>, label: string) => void; readonly addLabel: (labelId: string, label: string) => void }
): PaletteCommand[] {
  const set = (id: string, label: string, patch: Partial<Issue>, keywords?: string): PaletteCommand => ({
    id: `${group}:${id}`,
    label,
    group,
    keywords,
    run: () => apply.update(patch, label)
  });
  return [
    ...meta.states.map(state => set(`state-${state.id}`, `Set status: ${state.name}`, { stateId: state.id }, 'move state column')),
    ...([1, 2, 3, 4, 0] as Priority[]).map(p => set(`priority-${p}`, `Set priority: ${PRIORITY_NAMES[p]}`, { priority: p })),
    ...meta.users.map(user => set(`assign-${user.id}`, `Assign to ${user.name}`, { assigneeId: user.id }, `@${user.handle} assignee`)),
    set('unassign', 'Unassign', { assigneeId: null }, 'assignee nobody'),
    ...meta.labels.map(label => ({
      id: `${group}:label-${label.id}`,
      label: `Add label: ${label.name}`,
      group,
      keywords: 'tag',
      run: () => apply.addLabel(label.id, `Add label: ${label.name}`)
    }))
  ];
}
