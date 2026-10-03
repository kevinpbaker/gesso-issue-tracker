import type { IssueStore, Transaction } from '../model/IssueStore';
import { PRIORITY_NAMES, type Issue, type Workspace } from '../model/types';
import type { TriageChange } from './IssuesContract';

/**
 * Sets one property on some issues as one transaction, and names it the
 * way the undo toast should say it: "Moved WEB-12 to Done", "Assigned
 * 12 issues to Ada Okafor", "Removed Bug from 3 issues".
 *
 * Issues the change would leave as they are don't count: moving twelve
 * issues to Done when three are there already moves nine, and says so.
 * A change to none of them commits nothing.
 */
export function triage(store: IssueStore, ids: readonly string[], change: TriageChange, actorId = 'u0'): Transaction | null {
  const issues = ids.flatMap(id => store.get(id) ?? []);

  if (change.field === 'label') {
    const name = store.workspace.labels.find(label => label.id === change.labelId)?.name ?? change.labelId;
    // Off when every one has it, the way a checked box unchecks.
    const off = issues.length > 0 && issues.every(issue => issue.labelIds.includes(change.labelId));
    const changed = off ? issues : issues.filter(issue => !issue.labelIds.includes(change.labelId));
    if (changed.length === 0) return null;
    return store.updateEach(
      changed.map(issue => issue.id),
      issue => ({ labelIds: off ? issue.labelIds.filter(id => id !== change.labelId) : [...issue.labelIds, change.labelId] }),
      off ? `Removed ${name} from ${subject(changed)}` : `Added ${name} to ${subject(changed)}`,
      actorId
    );
  }

  const patch: Partial<Issue> =
    change.field === 'state' ? { stateId: change.stateId } : change.field === 'priority' ? { priority: change.priority } : { assigneeId: change.assigneeId };
  const [field, value] = Object.entries(patch)[0] as [keyof Issue, unknown];
  const changed = issues.filter(issue => issue[field] !== value);
  const label = describe(store.workspace, changed, patch);
  return changed.length === 0 || label === null ? null : store.update(changed.map(issue => issue.id), patch, label, actorId);
}

/**
 * What a patch to some issues did, in the words the triage keys use, or
 * null for a patch that isn't one property they set. The issue page
 * names its changes with this too, so the toast reads the same from
 * either place. `issues` are as they were before the patch.
 */
export function describe(workspace: Workspace, issues: readonly Issue[], patch: Partial<Issue>): string | null {
  const fields = Object.keys(patch) as (keyof Issue)[];
  if (issues.length === 0 || fields.length !== 1) return null;
  const what = subject(issues);
  if (patch.stateId !== undefined) {
    return `Moved ${what} to ${workspace.states.find(state => state.id === patch.stateId)?.name ?? patch.stateId}`;
  }
  if (patch.priority !== undefined) {
    return patch.priority === 0 ? `Cleared the priority of ${what}` : `Set ${what} to ${PRIORITY_NAMES[patch.priority]} priority`;
  }
  if (patch.assigneeId !== undefined) {
    return patch.assigneeId === null ? `Unassigned ${what}` : `Assigned ${what} to ${workspace.users.find(user => user.id === patch.assigneeId)?.name ?? patch.assigneeId}`;
  }
  if (patch.labelIds !== undefined && issues.length === 1) {
    // One label on or off, from the issue page's label field.
    const before = issues[0]!.labelIds;
    const added = patch.labelIds.filter(id => !before.includes(id));
    const removed = before.filter(id => !patch.labelIds!.includes(id));
    const name = (id: string) => workspace.labels.find(label => label.id === id)?.name ?? id;
    if (added.length === 1 && removed.length === 0) return `Added ${name(added[0]!)} to ${what}`;
    if (removed.length === 1 && added.length === 0) return `Removed ${name(removed[0]!)} from ${what}`;
    return `Changed the labels of ${what}`;
  }
  return null;
}

/**
 * The label for a patch to some issues: `describe`'s, counting only the
 * issues it changes, or the caller's own for a patch it doesn't name.
 * The selection toolbar, the palette and the issue page all name their
 * changes through this, so the undo toast reads the same from each.
 */
export function labelFor(store: IssueStore, ids: readonly string[], patch: Partial<Issue>, fallback: string): string {
  const changed = ids
    .flatMap(id => store.get(id) ?? [])
    .filter(issue => (Object.keys(patch) as (keyof Issue)[]).some(field => JSON.stringify(issue[field]) !== JSON.stringify(patch[field])));
  return describe(store.workspace, changed, patch) ?? fallback;
}

/** "WEB-12", or "12 issues". */
function subject(issues: readonly Issue[]): string {
  return issues.length === 1 ? issues[0]!.key : `${issues.length.toLocaleString('en-US')} issues`;
}
