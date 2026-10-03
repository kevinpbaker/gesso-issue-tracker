import { shortcut, type UiChild, type UiModifier, type UiNode } from 'gesso-core';
import { internalState, type ComponentContext } from 'gesso-framework';

import { ShortcutsService } from '../app/ShortcutsService';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import { PRIORITY_NAMES, type Priority } from '../model/types';
import { Picker, type PickerOption, type PickerRequest } from '../ui/Picker';
import { Issues, type TriageChange } from './IssuesContract';

/** What a triage key acts on: the selection, or the issue under the cursor. */
export interface TriageTarget {
  /** The issues, or none for the list's selection, which the app worker holds. */
  readonly ids?: readonly string[];
  /** "WEB-12", or "12 issues", for the picker's name. */
  readonly name: string;
  /** What the one issue has now, ticked in the picker. Unknown for several. */
  readonly now?: {
    readonly stateId?: string;
    readonly priority?: number;
    readonly assigneeId?: string | null;
    /** By name, as rows and cards carry them. */
    readonly labels?: readonly string[];
  };
  /** The row or card the picker opens beside. */
  readonly anchor: UiNode | null;
}

type Field = TriageChange['field'];

/** Each picker's name, before what it acts on, and its field's. */
const NAMES: Record<Field, { readonly title: string; readonly label: string }> = {
  state: { title: 'Set the status of', label: 'Status' },
  priority: { title: 'Set the priority of', label: 'Priority' },
  assignee: { title: 'Assign', label: 'Assignee' },
  label: { title: 'Add or remove labels on', label: 'Labels' }
};

/**
 * Triage without opening an issue, as Linear does it: s for status, a
 * for assignee, p for priority, a key for labels, and i to take it.
 * Each opens a picker beside the row or card, or (i) acts at once, on
 * the selection when there is one and the issue under the cursor when
 * there isn't. The app worker makes each one transaction and names it,
 * and the shell's undo toast says what happened and offers it back.
 *
 * The list and the board share this. The board's l is "next column",
 * so its labels key is Shift+L, and `labelsKey` says which.
 */
export function triageKeys(
  ctx: ComponentContext,
  options: { readonly group: string; readonly labelsKey: string; readonly labelsNote?: string; readonly target: () => TriageTarget | null }
): { readonly modifiers: UiModifier[]; readonly picker: UiChild } {
  const issues = ctx.channel(Issues);
  const meta = ctx.channel(WorkspaceMeta);
  const { registry } = ctx.inject(ShortcutsService);
  const request = internalState<PickerRequest | null>(null);

  const send = (target: TriageTarget, change: TriageChange): void =>
    issues.send.triage({ ...(target.ids === undefined ? {} : { ids: target.ids }), change });

  const choices = (field: Field, now: TriageTarget['now']): PickerOption[] => {
    const tick = (on: boolean) => (now === undefined ? {} : { checked: on });
    switch (field) {
      case 'state':
        return meta.view.states.value.map(state => ({ value: state.id, label: state.name, ...tick(now?.stateId === state.id) }));
      case 'priority':
        // A digit finds its priority, as the number keys do in Linear.
        return ([1, 2, 3, 4, 0] as Priority[]).map(p => ({ value: String(p), label: PRIORITY_NAMES[p], keywords: [String(p)], ...tick(now?.priority === p) }));
      case 'assignee':
        return [
          { value: '', label: 'Unassigned', keywords: ['nobody', 'none'], ...tick(now?.assigneeId === null) },
          ...meta.view.users.value.map(user => ({ value: user.id, label: user.name, detail: `@${user.handle}`, keywords: [user.handle], ...tick(now?.assigneeId === user.id) }))
        ];
      case 'label':
        return meta.view.labels.value.map(label => ({ value: label.id, label: label.name, ...tick(now?.labels?.includes(label.name) === true) }));
    }
  };

  const change = (field: Field, value: string): TriageChange => {
    switch (field) {
      case 'state':
        return { field, stateId: value };
      case 'priority':
        return { field, priority: Number(value) as Priority };
      case 'assignee':
        return { field, assigneeId: value === '' ? null : value };
      case 'label':
        return { field, labelId: value };
    }
  };

  const open = (field: Field): void => {
    const target = options.target();
    if (target === null) return;
    request.value = {
      title: `${NAMES[field].title} ${target.name}`,
      label: NAMES[field].label,
      options: choices(field, target.now),
      anchor: target.anchor,
      onChoose: value => send(target, change(field, value))
    };
  };

  const key = (keys: string, label: string, run: () => void) => shortcut({ registry, keys, label, scoped: false, group: options.group, run });

  return {
    modifiers: [
      key('s', 'Set status', () => open('state')),
      key('a', 'Assign', () => open('assignee')),
      key('p', 'Set priority', () => open('priority')),
      key(options.labelsKey, `Add or remove a label${options.labelsNote ?? ''}`, () => open('label')),
      key('i', 'Assign to me', () => {
        const target = options.target();
        if (target !== null) send(target, { field: 'assignee', assigneeId: meta.view.me.value });
      })
    ],
    picker: <Picker request={request} onClose={() => (request.value = null)} />
  };
}
