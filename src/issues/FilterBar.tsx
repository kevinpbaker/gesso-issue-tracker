import { combineLatest, type Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { autoFocus, percent, type UiChild } from 'gesso-core';
import { Button, Combobox, Select, TextInput, type ComboboxOption, type SelectOption } from 'gesso-components';
import { internalState, type ComponentContext, type Inputs } from 'gesso-framework';

import { WorkspaceMeta } from '../app/WorkspaceContract';
import { NONE, type DuePreset, type IssueFilter } from '../model/query';
import { PRIORITY_NAMES, type Priority } from '../model/types';
import { isEmptyFilter } from './filterUrl';

/**
 * The filter bar: a search field, then one control per thing the list
 * is narrowed by, each with a button to take it off, and a menu to add
 * another.
 *
 * It edits a refinement, which the list keeps in the url: every change
 * here is a new url, so a filtered list can be linked, reloaded, and
 * walked back with Back. Lists of values (status, assignee, label,
 * priority, project, team) are comboboxes of several values, matching
 * any of them; dates are presets relative to today.
 */

type Dimension = 'status' | 'assignee' | 'label' | 'priority' | 'project' | 'team' | 'due' | 'updated' | 'created';

const DIMENSIONS: readonly { readonly value: Dimension; readonly label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'label', label: 'Label' },
  { value: 'priority', label: 'Priority' },
  { value: 'project', label: 'Project' },
  { value: 'team', label: 'Team' },
  { value: 'due', label: 'Due date' },
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' }
];

const DUE_OPTIONS: readonly SelectOption[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due within a week' },
  { value: 'none', label: 'No due date' }
];

const WITHIN_OPTIONS: readonly SelectOption[] = [1, 7, 30, 90].map(days => ({
  value: String(days),
  label: days === 1 ? 'In the last day' : `In the last ${days} days`
}));

const PRIORITY_OPTIONS: readonly ComboboxOption[] = ([1, 2, 3, 4, 0] as Priority[]).map(p => ({ value: String(p), label: PRIORITY_NAMES[p] }));

/** Whether the filter narrows by a dimension. */
function has(filter: IssueFilter, dimension: Dimension): boolean {
  switch (dimension) {
    case 'status':
      return (filter.stateIds?.length ?? 0) > 0;
    case 'assignee':
      return (filter.assigneeIds?.length ?? 0) > 0;
    case 'label':
      return (filter.labelIds?.length ?? 0) > 0;
    case 'priority':
      return (filter.priorities?.length ?? 0) > 0;
    case 'project':
      return (filter.projectIds?.length ?? 0) > 0;
    case 'team':
      return (filter.teamIds?.length ?? 0) > 0;
    case 'due':
      return filter.due !== undefined;
    case 'updated':
      return filter.updatedWithin !== undefined;
    case 'created':
      return filter.createdWithin !== undefined;
  }
}

/** The filter without a dimension. */
function without(filter: IssueFilter, dimension: Dimension): IssueFilter {
  const next: Record<string, unknown> = { ...filter };
  const keys: Record<Dimension, string> = {
    status: 'stateIds',
    assignee: 'assigneeIds',
    label: 'labelIds',
    priority: 'priorities',
    project: 'projectIds',
    team: 'teamIds',
    due: 'due',
    updated: 'updatedWithin',
    created: 'createdWithin'
  };
  delete next[keys[dimension]];
  return next as IssueFilter;
}

/** How long the search waits for typing to stop before it filters. */
const SEARCH_AFTER_MS = 200;

export function FilterBar(inputs: Inputs<{ filter: IssueFilter; onChange: (filter: IssueFilter) => void }>, ctx: ComponentContext) {
  const meta = ctx.channel(WorkspaceMeta);
  const change = (next: IssueFilter): void => inputs.onChange.value(next);
  const current = (): IssueFilter => inputs.filter.value;
  /** Dimensions added from the menu but not given a value yet. */
  const adding = internalState<readonly Dimension[]>([]);
  /** The one just added, whose control takes the caret. */
  const fresh = internalState<Dimension | null>(null);

  const shown = combineLatest([inputs.filter, adding]).pipe(
    map(([filter, added]) => DIMENSIONS.filter(d => has(filter, d.value) || added.includes(d.value)).map(d => d.value)),
    distinctUntilChanged((a, b) => a.join() === b.join())
  );

  // The search field: what's typed is the filter a moment after typing stops.
  const draft = internalState(current().text ?? '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let typing = false;
  ctx.onUnmount(() => clearTimeout(timer));
  ctx.effect(
    inputs.filter.pipe(
      map(f => f.text ?? ''),
      distinctUntilChanged()
    ),
    text => {
      if (!typing) draft.value = text;
    }
  );

  const options = {
    status: meta.view.states.pipe(map(list => list.map(s => ({ value: s.id, label: s.name })))),
    assignee: meta.view.users.pipe(map(list => [{ value: NONE, label: 'No assignee' }, ...list.map(u => ({ value: u.id, label: u.name, detail: `@${u.handle}` }))])),
    label: meta.view.labels.pipe(map(list => list.map(l => ({ value: l.id, label: l.name })))),
    project: meta.view.projects.pipe(
      map(list => [
        { value: NONE, label: 'No project' },
        ...list.map(p => ({ value: p.id, label: p.name, detail: meta.view.teams.value.find(t => t.id === p.teamId)?.key ?? '' }))
      ])
    ),
    team: meta.view.teams.pipe(map(list => list.map(t => ({ value: t.id, label: t.name }))))
  };

  const control = (dimension: Dimension): UiChild => {
    const name = DIMENSIONS.find(d => d.value === dimension)!.label;
    const focus = fresh.value === dimension ? [autoFocus()] : [];
    const several = (values: Observable<readonly string[]>, list: Observable<readonly ComboboxOption[]> | readonly ComboboxOption[], write: (values: readonly string[]) => IssueFilter) => (
      <Combobox
        label={name}
        labelHidden
        multiple
        placeholder={`Any ${name.toLowerCase()}`}
        options={list}
        values={values}
        onValuesChange={next => change(next.length === 0 ? without(current(), dimension) : write(next))}
        width={220}
        rootModifiers={focus}
      />
    );
    const one = (value: Observable<string>, list: readonly SelectOption[], write: (value: string) => IssueFilter) => (
      <Select label={name} labelHidden compact placeholder="Choose…" options={list} value={value} onChange={next => change(write(next))} />
    );
    const f = inputs.filter;
    let body: UiChild;
    switch (dimension) {
      case 'status':
        body = several(f.pipe(map(x => x.stateIds ?? [])), options.status, v => ({ ...current(), stateIds: v }));
        break;
      case 'assignee':
        body = several(f.pipe(map(x => x.assigneeIds ?? [])), options.assignee, v => ({ ...current(), assigneeIds: v }));
        break;
      case 'label':
        body = several(f.pipe(map(x => x.labelIds ?? [])), options.label, v => ({ ...current(), labelIds: v }));
        break;
      case 'priority':
        body = several(f.pipe(map(x => (x.priorities ?? []).map(String))), PRIORITY_OPTIONS, v => ({ ...current(), priorities: v.map(Number) }));
        break;
      case 'project':
        body = several(f.pipe(map(x => x.projectIds ?? [])), options.project, v => ({ ...current(), projectIds: v }));
        break;
      case 'team':
        body = several(f.pipe(map(x => x.teamIds ?? [])), options.team, v => ({ ...current(), teamIds: v }));
        break;
      case 'due':
        body = one(f.pipe(map(x => x.due ?? '')), DUE_OPTIONS, v => ({ ...current(), due: v as DuePreset }));
        break;
      case 'updated':
        body = one(f.pipe(map(x => (x.updatedWithin === undefined ? '' : String(x.updatedWithin)))), WITHIN_OPTIONS, v => ({ ...current(), updatedWithin: Number(v) }));
        break;
      case 'created':
        body = one(f.pipe(map(x => (x.createdWithin === undefined ? '' : String(x.createdWithin)))), WITHIN_OPTIONS, v => ({ ...current(), createdWithin: Number(v) }));
        break;
    }
    return (
      <row key={dimension} gap={4} y="start" padding={4} borderRadius={8} backgroundColor="surface" role="group" label={`${name} filter`}>
        <text text={name} fontSize={12} color="textMuted" paddingTop={8} paddingLeft={4} />
        {body}
        <Button
          size="small"
          variant="plain"
          label={`Remove the ${name.toLowerCase()} filter`}
          onClick={() => {
            adding.value = adding.value.filter(d => d !== dimension);
            change(without(current(), dimension));
          }}>
          <text text="×" fontSize={14} color="textMuted" />
        </Button>
      </row>
    );
  };

  return (
    <row gap={8} paddingLeft={16} paddingRight={16} paddingBottom={8} y="start" width={percent(100)} flexWrap="wrap" role="search" label="Filter issues">
      <TextInput
        label="Search issues"
        placeholder="Search titles, descriptions, comments"
        value={draft}
        width={260}
        onChange={text => {
          draft.value = text;
          typing = true;
          clearTimeout(timer);
          timer = setTimeout(() => {
            typing = false;
            const next = { ...current(), text };
            change(text.trim() === '' ? (({ text: _, ...rest }) => rest)(next) : next);
          }, SEARCH_AFTER_MS);
        }}
      />
      {shown.pipe(map(list => list.map(control)))}
      <Select
        label="Add a filter"
        labelHidden
        compact
        placeholder="+ Filter"
        value=""
        options={shown.pipe(map(list => DIMENSIONS.filter(d => !list.includes(d.value))))}
        onChange={dimension => {
          fresh.value = dimension as Dimension;
          adding.value = [...adding.value, dimension as Dimension];
        }}
      />
      {inputs.filter.pipe(
        map(filter =>
          isEmptyFilter(filter)
            ? []
            : [
                <Button
                  key="clear"
                  size="small"
                  variant="plain"
                  label="Clear the filters"
                  onClick={() => {
                    adding.value = [];
                    draft.value = '';
                    change({});
                  }}>
                  <text text="Clear" fontSize={12} color="textMuted" />
                </Button>
              ]
        )
      )}
    </row>
  );
}
