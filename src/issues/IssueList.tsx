import { combineLatest, type Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { interactive, LazyColumn, percent, scrollPosition, shortcut } from 'gesso-core';
import { Button, Select } from 'gesso-components';
import { internalState, RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import { ShortcutsService } from '../app/ShortcutsService';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import type { GroupField, IssueQuery, QueryGroup, SortField } from '../model/query';
import { PRIORITY_NAMES, type Priority } from '../model/types';
import { PriorityIcon } from '../ui/PriorityIcon';
import { Probe } from '../ui/probe';
import { Issues, type IssueRow, type IssuesSummary } from './IssuesContract';

/**
 * A virtualized, grouped, keyboard-driven list of issues.
 *
 * The app worker runs the query and holds the selection; this draws a
 * window of the result and keeps the one thing that is purely visual,
 * the keyboard cursor. Group headers are rows too, so a display
 * position is either a header or an issue (`locate`, `positionOf`).
 * Every row is the same height, so the window and "scroll this row into
 * view" are both arithmetic, and a jump anywhere in 50,000 issues lands
 * exactly.
 *
 * The keys are Linear's: j and k (or the arrows) move, Shift extends,
 * x selects, Enter opens, Escape clears, Mod+A selects everything.
 */

export const ROW = 40;
/** Rows a list can plausibly show at once; the service adds overscan. */
const VISIBLE = 40;

const HOVER = interactive({ hover: true, press: false, hovered: { backgroundColor: 'surface' } });

export type Located = { readonly kind: 'header'; readonly group: QueryGroup } | { readonly kind: 'issue'; readonly index: number };

/** Whether groups get header rows: a single "All issues" group does not. */
export function headed(summary: IssuesSummary): boolean {
  return !(summary.groups.length === 1 && summary.groups[0]!.key === 'all');
}

/** Display rows: every shown issue, plus a header per group when grouped. */
export function displayCount(summary: IssuesSummary): number {
  return summary.total + (headed(summary) ? summary.groups.length : 0);
}

/** What sits at a display position. */
export function locate(summary: IssuesSummary, position: number): Located | null {
  if (!headed(summary)) {
    return position < summary.total ? { kind: 'issue', index: position } : null;
  }
  let at = 0;
  for (const group of summary.groups) {
    if (position === at) return { kind: 'header', group };
    if (position <= at + group.shown) return { kind: 'issue', index: group.start + (position - at - 1) };
    at += group.shown + 1;
  }
  return null;
}

/** Where an issue index is displayed: the inverse of `locate`. */
export function positionOf(summary: IssuesSummary, index: number): number {
  if (!headed(summary)) return index;
  let at = 0;
  for (const group of summary.groups) {
    at += 1;
    if (index < group.start + group.shown) return at + (index - group.start);
    at += group.shown;
  }
  return at;
}

const GROUPS: { value: GroupField; label: string }[] = [
  { value: 'state', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'project', label: 'Project' },
  { value: 'team', label: 'Team' },
  { value: 'none', label: 'No grouping' }
];

const SORTS: { value: SortField; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'updatedAt', label: 'Last updated' },
  { value: 'createdAt', label: 'Created' },
  { value: 'key', label: 'ID' },
  { value: 'title', label: 'Title' }
];

export function IssueList(inputs: Inputs<{ query: IssueQuery; empty?: string }>, ctx: ComponentContext) {
  const issues = ctx.channel(Issues);
  const router = ctx.inject(RouterService);
  const { registry } = ctx.inject(ShortcutsService);

  const cursor = internalState(0);
  let anchor = 0;
  const scrollY = internalState(0);
  const probe = new Probe();

  // The route supplies the filter and a default arrangement; the toolbar
  // can rearrange it without changing which issues are in the list.
  const group = internalState<GroupField | null>(null);
  const sort = internalState<SortField | null>(null);
  const collapsed = internalState<readonly string[]>([]);
  const query = combineLatest([inputs.query, group, sort, collapsed]).pipe(
    map(([base, chosenGroup, chosenSort, folded]): IssueQuery => ({
      ...base,
      group: chosenGroup ?? base.group,
      sort:
        chosenSort === null
          ? base.sort
          : { field: chosenSort, direction: chosenSort === 'updatedAt' || chosenSort === 'createdAt' ? 'desc' : 'asc' },
      collapsed: folded
    })),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );
  ctx.effect(query, next => issues.send.setQuery(next));
  // A different filter is a different list: start at its top.
  ctx.effect(inputs.query.pipe(distinctUntilChanged((a, b) => JSON.stringify(a.filter) === JSON.stringify(b.filter))), () => {
    cursor.value = 0;
    anchor = 0;
    collapsed.value = [];
    scrollY.value = 0;
  });

  let start = -1;
  const report = (offsetY: number): void => {
    const first = Math.max(0, Math.floor(offsetY / ROW));
    if (first === start) return;
    start = first;
    const located = locate(issues.view.summary.value, first);
    const index = located?.kind === 'issue' ? located.index : (located?.group.start ?? first);
    issues.send.setWindow({ start: Math.max(0, index - 2), end: index + VISIBLE });
  };
  report(0);

  /** Scrolls just enough to show an issue's row. */
  const reveal = (index: number): void => {
    const top = positionOf(issues.view.summary.value, index) * ROW;
    const height = probe.box()?.height ?? 600;
    if (top < scrollY.value) scrollY.value = top;
    else if (top + ROW > scrollY.value + height) scrollY.value = top + ROW - height;
  };

  const total = () => issues.view.summary.value.total;
  const move = (by: number, extend: boolean): void => {
    if (total() === 0) return;
    const next = Math.max(0, Math.min(total() - 1, cursor.value + by));
    cursor.value = next;
    if (extend) {
      issues.send.select({ ranges: [[anchor, next]], mode: 'replace' });
    } else {
      anchor = next;
    }
    reveal(next);
  };
  const toggle = (index = cursor.value): void => {
    if (total() === 0) return;
    cursor.value = index;
    anchor = index;
    issues.send.select({ ranges: [[index, index]], mode: 'toggle' });
  };
  const open = (index = cursor.value): void => {
    const id = issues.view.window.value[String(index)];
    const row = id === undefined ? undefined : issues.view.rows.value[id];
    if (row !== undefined) router.navigate(`/issue/${row.key}`);
  };
  const fold = (key: string): void => {
    const current = collapsed.value;
    collapsed.value = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
  };

  const key = (keys: string, label: string, run: () => void) => shortcut({ registry, keys, label, scoped: false, group: 'List', run });

  const list = LazyColumn(
    {
      flexGrow: 1,
      count: issues.view.summary.pipe(map(displayCount)),
      revision: issues.view.summary,
      estimatedExtent: ROW,
      scrollY,
      label: 'Issues',
      modifiers: [
        scrollPosition({
          onChange: offset => {
            scrollY.value = offset.y;
            report(offset.y);
          }
        }),
        probe.modifier
      ]
    },
    position => {
      const located = locate(issues.view.summary.value, position);
      if (located === null) return <box height={ROW} />;
      return located.kind === 'header' ? (
        <GroupHeader group={located.group} onToggle={() => fold(located.group.key)} />
      ) : (
        <IssueRowView index={located.index} cursor={cursor} onOpen={() => open(located.index)} onToggle={() => toggle(located.index)} />
      );
    }
  );

  return (
    <column
      width={percent(100)}
      height={percent(100)}
      modifiers={[
        key('j', 'Next issue', () => move(1, false)),
        key('ArrowDown', 'Next issue', () => move(1, false)),
        key('k', 'Previous issue', () => move(-1, false)),
        key('ArrowUp', 'Previous issue', () => move(-1, false)),
        key('Shift+J', 'Extend the selection down', () => move(1, true)),
        key('Shift+ArrowDown', 'Extend the selection down', () => move(1, true)),
        key('Shift+K', 'Extend the selection up', () => move(-1, true)),
        key('Shift+ArrowUp', 'Extend the selection up', () => move(-1, true)),
        key('x', 'Select the issue', () => toggle()),
        key('Enter', 'Open the issue', () => open()),
        key('Escape', 'Clear the selection', () => issues.send.clearSelection()),
        key('Mod+A', 'Select every issue', () => {
          if (total() > 0) issues.send.select({ ranges: [[0, total() - 1]], mode: 'replace' });
        })
      ]}>
      <Toolbar
        group={query.pipe(map(q => q.group))}
        sort={query.pipe(map(q => q.sort.field))}
        onGroup={next => (group.value = next)}
        onSort={next => (sort.value = next)}
      />
      <box height={1} backgroundColor="border" />
      {issues.view.summary.pipe(
        map(summary =>
          summary.total === 0 && summary.groups.length === 0 ? (
            <box key="empty" flexGrow={1} x="center" y="center">
              <text text={inputs.empty.pipe(map(text => text ?? 'No issues'))} fontSize={13} color="textMuted" />
            </box>
          ) : (
            []
          )
        )
      )}
      {list}
      <BulkBar />
    </column>
  );
}

function Toolbar(
  inputs: Inputs<{ group: GroupField; sort: SortField; onGroup: (group: GroupField) => void; onSort: (sort: SortField) => void }>,
  ctx: ComponentContext
) {
  const issues = ctx.channel(Issues);
  return (
    <row height={44} paddingLeft={16} paddingRight={16} gap={12} y="center">
      <text
        text={issues.view.summary.pipe(
          map(summary => {
            const all = summary.groups.reduce((sum, group) => sum + group.count, 0);
            return `${all.toLocaleString('en-US')} issues · ${summary.queryMs} ms`;
          })
        )}
        fontSize={12}
        color="textMuted"
        flexGrow={1}
      />
      <Select label="Group by" compact={true} value={inputs.group} options={GROUPS} onChange={next => inputs.onGroup.value(next as GroupField)} />
      <Select label="Sort by" compact={true} value={inputs.sort} options={SORTS} onChange={next => inputs.onSort.value(next as SortField)} />
    </row>
  );
}

function GroupHeader(inputs: Inputs<{ group: QueryGroup; onToggle: () => void }>, _ctx: ComponentContext) {
  const group = inputs.group;
  return (
    <button
      height={ROW}
      paddingLeft={16}
      paddingRight={16}
      backgroundColor="surface"
      cursor="pointer"
      label={group.pipe(map(g => `${g.label}, ${g.count} issues, ${g.collapsed ? 'collapsed' : 'expanded'}`))}
      states={group.pipe(map(g => (g.collapsed ? ['collapsed'] : ['expanded'])))}
      onClick={() => inputs.onToggle.value()}
      x="stretch"
      y="stretch">
      <row gap={8} y="center">
        <text text={group.pipe(map(g => (g.collapsed ? '▸' : '▾')))} fontSize={11} color="textMuted" width={10} />
        <text text={group.pipe(map(g => g.label))} fontSize={13} fontWeight={600} color="text" />
        <text text={group.pipe(map(g => g.count.toLocaleString('en-US')))} fontSize={12} color="textMuted" />
      </row>
    </button>
  );
}

/** "now", "5m", "3h", "4d", "2w", or "Mar 4". */
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function IssueRowView(
  inputs: Inputs<{ index: number; cursor: number; onOpen: () => void; onToggle: () => void }>,
  ctx: ComponentContext
) {
  const issues = ctx.channel(Issues);
  const index = inputs.index.value;
  const id: Observable<string | undefined> = issues.view.window.pipe(
    map(window => window[String(index)]),
    distinctUntilChanged()
  );
  const row: Observable<IssueRow | undefined> = combineLatest([id, issues.view.rows]).pipe(
    map(([current, rows]) => (current === undefined ? undefined : rows[current])),
    distinctUntilChanged()
  );
  const selected = combineLatest([id, issues.view.selected]).pipe(
    map(([current, chosen]) => current !== undefined && chosen[current] === true),
    distinctUntilChanged()
  );
  const atCursor = inputs.cursor.pipe(
    map(at => at === index),
    distinctUntilChanged()
  );
  const field = <T,>(read: (r: IssueRow) => T, empty: T) => row.pipe(map(r => (r === undefined ? empty : read(r))));

  return (
    <button
      height={ROW}
      paddingLeft={8}
      paddingRight={16}
      cursor="pointer"
      label={field(r => `${r.key} ${r.title}`, 'Loading issue')}
      states={selected.pipe(map(on => (on ? ['selected'] : [])))}
      backgroundColor={combineLatest([selected, atCursor]).pipe(
        map(([on, here]) => (on ? 'surfaceRaised' : here ? 'surface' : 'background'))
      )}
      onClick={() => inputs.onOpen.value()}
      x="stretch"
      y="stretch"
      modifiers={[HOVER]}>
      <row gap={12} y="center">
        <box width={3} height={24} flexShrink={0} borderRadius={2} backgroundColor={atCursor.pipe(map(here => (here ? 'primary' : 'background')))} />
        <button
          label={selected.pipe(map(on => (on ? 'Deselect' : 'Select')))}
          states={selected.pipe(map(on => (on ? ['checked'] : [])))}
          onClick={() => inputs.onToggle.value()}
          width={16}
          height={16}
          flexShrink={0}
          borderRadius={4}
          borderWidth={1.5}
          borderColor={selected.pipe(map(on => (on ? 'primary' : 'border')))}
          backgroundColor={selected.pipe(map(on => (on ? 'primary' : 'background')))}
          x="center"
          y="center">
          <text text={selected.pipe(map(on => (on ? '✓' : '')))} fontSize={10} color="background" />
        </button>
        <box flexShrink={0}>
          <PriorityIcon priority={field(r => r.priority, 0)} />
        </box>
        <box width={72} flexShrink={0}>
          <text text={field(r => r.key, '')} fontSize={12} color="textMuted" maxLines={1} />
        </box>
        {/* The title keeps at least 140 px; labels give way first. */}
        <box flexGrow={1} flexShrink={1} flexBasis={0} minWidth={140}>
          <text text={field(r => r.title, '')} fontSize={13} color="text" maxLines={1} textOverflow="ellipsis" />
        </box>
        <box flexShrink={1} minWidth={0} maxWidth={180} overflow="hidden" x="stretch">
          <text text={field(r => r.labels.join(' · '), '')} fontSize={11} color="textMuted" maxLines={1} textOverflow="ellipsis" />
        </box>
        <box width={88} flexShrink={0}>
          <text text={field(r => r.stateName, '')} fontSize={11} color="textMuted" maxLines={1} />
        </box>
        <box width={44} flexShrink={0} x="end">
          <text text={field(r => ago(r.updatedAt), '')} fontSize={11} color="textMuted" maxLines={1} />
        </box>
        <box width={24} height={24} borderRadius={12} backgroundColor="surfaceRaised" x="center" y="center" flexShrink={0}>
          <text text={field(r => r.initials, '')} fontSize={10} fontWeight={600} color="textMuted" />
        </box>
      </row>
    </button>
  );
}

/**
 * What to do to the selection: status, priority, assignee, a label.
 * Each choice is one transaction in the app worker, so one Mod+Z puts
 * back all of it, however many issues it touched.
 */
function BulkBar(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const issues = ctx.channel(Issues);
  const meta = ctx.channel(WorkspaceMeta);
  const count = issues.view.selectedCount;
  const plural = (n: number) => `${n.toLocaleString('en-US')} issue${n === 1 ? '' : 's'}`;
  const name = <T extends { id: string; name: string }>(list: readonly T[], id: string) => list.find(item => item.id === id)?.name ?? id;

  const apply = (patch: Parameters<typeof issues.send.updateSelected>[0]['patch'], describe: string) =>
    issues.send.updateSelected({ patch, label: `${describe} on ${plural(count.value)}` });

  return (
    <column visible={count.pipe(map(n => n > 0))} role="toolbar" label="Selected issues">
      <box height={1} backgroundColor="border" />
      <row height={52} paddingLeft={16} paddingRight={16} gap={10} y="center" backgroundColor="surface">
        <text text={count.pipe(map(n => `${plural(n)} selected`))} fontSize={13} fontWeight={600} color="text" flexGrow={1} />
        <Select
          label="Set status"
          placeholder="Status"
          compact={true}
          value=""
          options={meta.view.states.pipe(map(states => states.map(s => ({ value: s.id, label: s.name }))))}
          onChange={id => apply({ stateId: id }, `Set status to ${name(meta.view.states.value, id)}`)}
        />
        <Select
          label="Set priority"
          placeholder="Priority"
          compact={true}
          value=""
          options={[1, 2, 3, 4, 0].map(p => ({ value: String(p), label: PRIORITY_NAMES[p as Priority] }))}
          onChange={p => apply({ priority: Number(p) as Priority }, `Set priority to ${PRIORITY_NAMES[Number(p) as Priority]}`)}
        />
        <Select
          label="Set assignee"
          placeholder="Assignee"
          compact={true}
          value=""
          options={meta.view.users.pipe(map(users => [{ value: 'none', label: 'Unassigned' }, ...users.map(u => ({ value: u.id, label: u.name }))]))}
          onChange={id =>
            id === 'none' ? apply({ assigneeId: null }, 'Unassigned') : apply({ assigneeId: id }, `Assigned ${name(meta.view.users.value, id)}`)
          }
        />
        <Select
          label="Add label"
          placeholder="Add label"
          compact={true}
          value=""
          options={meta.view.labels.pipe(map(labels => labels.map(l => ({ value: l.id, label: l.name }))))}
          onChange={id =>
            issues.send.addLabelToSelected({ labelId: id, label: `Added ${name(meta.view.labels.value, id)} to ${plural(count.value)}` })
          }
        />
        <Button label="Clear selection" size="small" variant="plain" onClick={() => issues.send.clearSelection()}>
          <text text="Clear" fontSize={12} color="text" />
        </Button>
      </row>
    </column>
  );
}
