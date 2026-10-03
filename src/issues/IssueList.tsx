import { combineLatest, type Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { autoFocus, focusRing, interactive, LazyColumn, percent, scrollPosition, shortcut, type UiNode } from 'gesso-core';
import { Button, Select } from 'gesso-components';
import { FocusService, formatUrl, internalState, RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import { useCopyIssue, type CopyWhat } from '../app/copyIssue';
import { ShortcutsService } from '../app/ShortcutsService';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import type { GroupField, IssueFilter, IssueQuery, QueryGroup, SortField } from '../model/query';
import { FilterBar } from './FilterBar';
import { SaveViewDialog } from '../views/SaveViewDialog';
import { CommandsService } from '../palette/CommandsService';
import { COPY_LINK, copyCommands, propertyCommands } from '../palette/propertyCommands';
import { filterFromQuery, filterToQuery, isEmptyFilter } from './filterUrl';
import { PRIORITY_NAMES, type Priority } from '../model/types';
import { PriorityIcon } from '../ui/PriorityIcon';
import { Probe } from '../ui/probe';
import { Issues, type IssueRow, type IssuesSummary } from './IssuesContract';
import { ListPlaces } from './ListPlaces';
import { triageKeys } from './triageKeys';

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
 * The cursor, the scroll and the toolbar's arrangement are kept in
 * `ListPlaces` as the list closes and put back as it opens, so a list
 * left for an issue comes back as it was, with the cursor on the issue
 * the issue page showed last.
 *
 * The keys are Linear's: j and k (or the arrows) move, Shift extends,
 * x selects, Enter opens, Escape clears, Mod+A selects everything; and
 * s, a, p, l and i triage the selection, or the issue under the cursor
 * when nothing is selected (`triageKeys`).
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

/**
 * The query a list runs: its screen's, as the toolbar rearranged it,
 * narrowed by the url. The issue page builds a list's query the same
 * way, to step through it as the list would show it.
 */
export function arrange(
  base: IssueQuery,
  chosen: { readonly group: GroupField | null; readonly sort: SortField | null; readonly collapsed: readonly string[] },
  narrowed: IssueFilter = {}
): IssueQuery {
  return {
    ...base,
    ...(isEmptyFilter(narrowed) ? {} : { refine: narrowed }),
    group: chosen.group ?? base.group,
    sort:
      chosen.sort === null
        ? base.sort
        : { field: chosen.sort, direction: chosen.sort === 'updatedAt' || chosen.sort === 'createdAt' ? 'desc' : 'asc' },
    collapsed: chosen.collapsed
  };
}

/** Which issues a list shows, as a string to compare: its filters, not how they're arranged. */
export function shownBy(base: IssueQuery, narrowed: IssueFilter = {}): string {
  return JSON.stringify([base.filter, base.also ?? [], isEmptyFilter(narrowed) ? {} : narrowed]);
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

  const places = ctx.inject(ListPlaces);
  const cursor = internalState(0);
  let anchor = 0;
  const scrollY = internalState(0);
  /** An issue the list was asked to open on, until it can be scrolled to: it needs the result and the list's height. */
  let landing: number | null = null;
  const probe = new Probe(() => land());

  // The route supplies the filter and a default arrangement; the toolbar
  // can rearrange it without changing which issues are in the list.
  const group = internalState<GroupField | null>(null);
  const sort = internalState<SortField | null>(null);
  const collapsed = internalState<readonly string[]>([]);
  const saving = internalState(false);
  const meta = ctx.channel(WorkspaceMeta);
  const commands = ctx.inject(CommandsService);
  // While issues are selected, the palette can change all of them at once.
  ctx.onUnmount(
    commands.register(() => {
      const count = issues.view.selectedCount.value;
      if (count === 0) return [];
      const group = count === 1 ? 'The selected issue' : `The ${count.toLocaleString('en-US')} selected issues`;
      return [
        ...propertyCommands({ states: meta.view.states.value, users: meta.view.users.value, labels: meta.view.labels.value }, group, {
          update: (patch, label) => issues.send.updateSelected({ patch, label }),
          addLabel: (labelId, label) => issues.send.addLabelToSelected({ labelId, label })
        }),
        { id: 'selection:clear', label: 'Clear the selection', group, run: () => issues.send.clearSelection() }
      ];
    })
  );
  // Folding a group, from the keyboard.
  ctx.onUnmount(
    commands.register(() => {
      const groups = issues.view.summary.value.groups.filter(g => g.key !== 'all');
      return groups.map(g => ({
        id: `fold:${g.key}`,
        label: `${g.collapsed ? 'Expand' : 'Collapse'} the ${g.label} group`,
        group: 'List',
        keywords: 'fold unfold',
        run: () => fold(g.key)
      }));
    })
  );
  // What the person narrowed the list to, kept in the url's query string.
  const refine = router.match.pipe(
    map(match => filterFromQuery(match?.query ?? {})),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );
  const setRefine = (next: IssueFilter): void => {
    const match = router.match.value;
    if (match === null) return;
    // Replaced rather than pushed: each keystroke of a search is not a
    // page to go Back through.
    router.navigate(formatUrl(match.path, filterToQuery(next)), { replace: true });
  };
  const query = combineLatest([inputs.query, group, sort, collapsed, refine]).pipe(
    map(([base, chosenGroup, chosenSort, folded, narrowed]) => arrange(base, { group: chosenGroup, sort: chosenSort, collapsed: folded }, narrowed)),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );
  // Where this list was left, kept under its path; the refinement in
  // the query string is part of which issues it shows.
  const path = router.match.pipe(
    map(match => match?.path ?? ''),
    distinctUntilChanged()
  );
  const shown = combineLatest([inputs.query, refine]).pipe(
    map(([base, narrowed]) => shownBy(base, narrowed)),
    distinctUntilChanged()
  );
  let here: string | null = null;
  let showing = '';
  const keep = (): void => {
    if (here === null) return;
    places.save(here, {
      shown: showing,
      group: group.value,
      sort: sort.value,
      collapsed: collapsed.value,
      cursor: cursor.value,
      scrollY: scrollY.value
    });
  };
  ctx.onUnmount(keep);
  // Opened, or walked to another team's list: the place it was left in,
  // if it still shows the same issues. A different filter on the same
  // list is a different list: start at its top.
  ctx.effect(combineLatest([path, shown]), ([at, which]) => {
    const arriving = at !== here;
    if (arriving) keep();
    const place = arriving ? places.get(at) : undefined;
    if (arriving) {
      group.value = place?.group ?? null;
      sort.value = place?.sort ?? null;
    }
    const back = place !== undefined && place.shown === which;
    here = at;
    showing = which;
    cursor.value = back ? place.cursor : 0;
    collapsed.value = back ? place.collapsed : [];
    scrollY.value = back ? place.scrollY : 0;
    landing = arriving ? (places.takeLanding(at) ?? null) : null;
    if (landing !== null) cursor.value = landing;
    anchor = cursor.value;
    land();
  });
  ctx.effect(query, next => {
    issues.send.setQuery(next);
    // What the issue page steps through, and where its Escape comes back to.
    places.origin = { url: router.match.value?.url ?? '', list: { kind: 'list', query: next } };
  });
  // The issue page said where it was last: the cursor goes there, and
  // the list scrolls as little as it can from where it was to show it.
  ctx.effect(issues.view.summary, () => land());
  function land(): void {
    const box = probe.box();
    if (landing === null || box === null || box.height === 0 || landing >= total()) return;
    reveal(landing);
    landing = null;
  }

  let start = -1;
  const report = (offsetY: number): void => {
    const first = Math.max(0, Math.floor(offsetY / ROW));
    if (first === start) return;
    start = first;
    const located = locate(issues.view.summary.value, first);
    const index = located?.kind === 'issue' ? located.index : (located?.group.start ?? first);
    issues.send.setWindow({ start: Math.max(0, index - 2), end: index + VISIBLE });
  };
  // The window where the list was left: the top, for a list new to this visit.
  report(scrollY.value);

  /** Scrolls just enough to show an issue's row. */
  function reveal(index: number): void {
    const top = positionOf(issues.view.summary.value, index) * ROW;
    const height = probe.box()?.height ?? 600;
    if (top < scrollY.value) scrollY.value = top;
    else if (top + ROW > scrollY.value + height) scrollY.value = top + ROW - height;
  }

  function total(): number {
    return issues.view.summary.value.total;
  }
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
  // The issue under the cursor's link or key, from the palette or Mod+Shift+C.
  const copyIssue = useCopyIssue(ctx);
  const copyAtCursor = (what: CopyWhat): void => {
    const id = issues.view.window.value[String(cursor.value)];
    const row = id === undefined ? undefined : issues.view.rows.value[id];
    if (row !== undefined) copyIssue(row.key, what);
  };
  ctx.onUnmount(commands.register(() => (total() === 0 ? [] : copyCommands('List', copyAtCursor))));
  const fold = (key: string): void => {
    const current = collapsed.value;
    collapsed.value = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
  };

  // The rows on screen, by position, for the listbox's active descendant.
  const rowNodes = new Map<number, UiNode>();
  const rowsChanged = internalState(0);
  const trackRow = (index: number, node: UiNode | null): void => {
    if (node === null) {
      if (rowNodes.has(index)) rowNodes.delete(index);
    } else {
      rowNodes.set(index, node);
    }
    rowsChanged.value += 1;
  };
  const cursorRow = combineLatest([cursor, rowsChanged]).pipe(
    map(([at]) => rowNodes.get(at) ?? null),
    distinctUntilChanged()
  );

  const key = (keys: string, label: string, run: () => void) => shortcut({ registry, keys, label, scoped: false, group: 'List', run });

  const triage = triageKeys(ctx, {
    group: 'List',
    labelsKey: 'l',
    target: () => {
      const count = issues.view.selectedCount.value;
      const anchor = rowNodes.get(cursor.value) ?? null;
      if (count > 0) return { name: count === 1 ? '1 issue' : `${count.toLocaleString('en-US')} issues`, anchor };
      const id = issues.view.window.value[String(cursor.value)];
      const row = id === undefined ? undefined : issues.view.rows.value[id];
      if (row === undefined) return null;
      return {
        ids: [row.id],
        name: row.key,
        now: { stateId: row.stateId, priority: row.priority, assigneeId: row.assigneeId, labels: row.labels },
        anchor
      };
    }
  });

  let listNode: UiNode | null = null;
  const list = LazyColumn(
    {
      ref: (node: UiNode | null) => (listNode = node),
      flexGrow: 1,
      flexBasis: 0,
      count: issues.view.summary.pipe(map(displayCount)),
      revision: issues.view.summary,
      estimatedExtent: ROW,
      scrollY,
      // One tab stop, as a list a person walks with the arrows is: the
      // rows are its options, and the row under the cursor is its active
      // descendant, so a screen reader reads each as the cursor reaches it.
      label: 'Issues',
      role: 'listbox',
      // Rows are selected as a set (x, Shift+J), not by moving the
      // cursor: without this the row under it is announced as selected.
      states: ['multiselectable'],
      focusable: true,
      activeDescendant: cursorRow,
      modifiers: [
        scrollPosition({
          onChange: offset => {
            scrollY.value = offset.y;
            report(offset.y);
          }
        }),
        probe.modifier,
        LIST_FOCUS,
        // A screen opened is a screen to start in: focus goes to its list,
        // not back to the top of the sidebar.
        autoFocus()
      ]
    },
    position => {
      const located = locate(issues.view.summary.value, position);
      if (located === null) return <box height={ROW} />;
      return located.kind === 'header' ? (
        <GroupHeader group={located.group} onToggle={() => fold(located.group.key)} />
      ) : (
        <IssueRowView
          index={located.index}
          total={issues.view.summary.pipe(map(summary => summary.total))}
          cursor={cursor}
          track={trackRow}
          onOpen={() => open(located.index)}
          onToggle={() => toggle(located.index)}
        />
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
        key('Mod+Shift+C', COPY_LINK, () => copyAtCursor('link')),
        key('Escape', 'Clear the selection', () => issues.send.clearSelection()),
        key('Mod+A', 'Select every issue', () => {
          if (total() > 0) issues.send.select({ ranges: [[0, total() - 1]], mode: 'replace' });
        }),
        ...triage.modifiers
      ]}>
      <Toolbar
        group={query.pipe(map(q => q.group))}
        sort={query.pipe(map(q => q.sort.field))}
        onGroup={next => (group.value = next)}
        onSort={next => (sort.value = next)}
        onSave={() => (saving.value = true)}
      />
      <SaveViewDialog open={saving} onClose={() => (saving.value = false)} query={query} />
      <FilterBar filter={refine} onChange={setRefine} />
      <box height={1} backgroundColor="border" />
      {issues.view.summary.pipe(
        map(summary =>
          summary.total === 0 && summary.groups.length === 0 ? (
            <box key="empty" flexGrow={1} flexBasis={0} x="center" y="center">
              <text text={inputs.empty.pipe(map(text => text ?? 'No issues'))} fontSize={13} color="textMuted" />
            </box>
          ) : (
            []
          )
        )
      )}
      {list}
      <BulkBar list={() => listNode} />
      {triage.picker}
    </column>
  );
}

function Toolbar(
  inputs: Inputs<{
    group: GroupField;
    sort: SortField;
    onGroup: (group: GroupField) => void;
    onSort: (sort: SortField) => void;
    onSave: () => void;
  }>,
  ctx: ComponentContext
) {
  const issues = ctx.channel(Issues);
  return (
    // Wraps onto a second line rather than run its controls over each other.
    <row minHeight={44} paddingLeft={16} paddingRight={16} paddingTop={6} paddingBottom={6} gap={12} y="center" flexWrap="wrap">
      <text
        text={issues.view.summary.pipe(
          map(summary => {
            const all = summary.groups.reduce((sum, group) => sum + group.count, 0);
            return `${all.toLocaleString('en-US')} issues · ${summary.queryMs} ms`;
          })
        )}
        // The time is a proof for the eye; a screen reader hears the count.
        label={issues.view.summary.pipe(
          map(summary => `${summary.groups.reduce((sum, group) => sum + group.count, 0).toLocaleString('en-US')} issues`)
        )}
        fontSize={12}
        color="textMuted"
        maxLines={1}
        textOverflow="ellipsis"
        flexGrow={1}
      />
      <Select label="Group by" compact={true} value={inputs.group} options={GROUPS} onChange={next => inputs.onGroup.value(next as GroupField)} />
      <Select label="Sort by" compact={true} value={inputs.sort} options={SORTS} onChange={next => inputs.onSort.value(next as SortField)} />
      <Button size="small" variant="plain" label="Save as a view" onClick={() => inputs.onSave.value()}>
        <text text="Save view" fontSize={12} color="text" />
      </Button>
    </row>
  );
}

function GroupHeader(inputs: Inputs<{ group: QueryGroup; onToggle: () => void }>, _ctx: ComponentContext) {
  const group = inputs.group;
  return (
    <button
      // The pointer's way to fold a group; the keyboard's is the palette.
      focusable={false}
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

/** Where keyboard focus is, when it's on the list. One value, so it's never re-attached. */
const LIST_FOCUS = focusRing();

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
  inputs: Inputs<{
    index: number;
    total: number;
    cursor: number;
    track: (index: number, node: UiNode | null) => void;
    onOpen: () => void;
    onToggle: () => void;
  }>,
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
    <box
      ref={(node: UiNode | null) => inputs.track.value(index, node)}
      height={ROW}
      paddingLeft={8}
      paddingRight={16}
      cursor="pointer"
      role="option"
      label={field(r => `${r.key} ${r.title}, ${r.stateName}${r.assigneeName === '' ? '' : `, ${r.assigneeName}`}`, 'Loading issue')}
      states={selected.pipe(map(on => (on ? ['selected'] : [])))}
      posInSet={index + 1}
      setSize={inputs.total}
      backgroundColor={combineLatest([selected, atCursor]).pipe(
        map(([on, here]) => (on ? 'selectionBackground' : here ? 'surface' : 'background'))
      )}
      onClick={() => inputs.onOpen.value()}
      x="stretch"
      y="stretch"
      modifiers={[HOVER]}>
      <row gap={12} y="center">
        <box width={3} height={24} flexShrink={0} borderRadius={2} backgroundColor={atCursor.pipe(map(here => (here ? 'primary' : 'background')))} />
        <button
          // A target for the pointer; the keyboard selects with x, and the
          // option says whether it's selected.
          focusable={false}
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
        <box width={24} height={24} borderRadius={12} backgroundColor="controlBackground" x="center" y="center" flexShrink={0}>
          <text text={field(r => r.initials, '')} fontSize={10} fontWeight={600} color="textMuted" />
        </box>
      </row>
    </box>
  );
}

/**
 * What to do to the selection: status, priority, assignee, a label.
 * Each choice is one transaction in the app worker, so one Mod+Z puts
 * back all of it, however many issues it touched.
 */
function BulkBar(inputs: Inputs<{ list: () => UiNode | null }>, ctx: ComponentContext) {
  const issues = ctx.channel(Issues);
  const meta = ctx.channel(WorkspaceMeta);
  const focus = ctx.inject(FocusService);
  const count = issues.view.selectedCount;

  // The bar leaves when the selection empties, and with it whatever
  // control in it had the caret (Clear, most often): the caret goes back
  // to the list. Subscribed before the bar's children are, so it runs
  // while the focused control is still in the bar.
  let barNode: UiNode | null = null;
  ctx.effect(count.pipe(map(n => n > 0), distinctUntilChanged()), shown => {
    const held = focus.focused.value;
    const list = inputs.list.value();
    if (shown || list === null || held === null || barNode === null) return;
    for (let at: UiNode | null = held; at !== null; at = at.parent) {
      if (at === barNode) {
        focus.focus(list);
        return;
      }
    }
  });
  const plural = (n: number) => `${n.toLocaleString('en-US')} issue${n === 1 ? '' : 's'}`;
  const name = <T extends { id: string; name: string }>(list: readonly T[], id: string) => list.find(item => item.id === id)?.name ?? id;

  const apply = (patch: Parameters<typeof issues.send.updateSelected>[0]['patch'], describe: string) =>
    issues.send.updateSelected({ patch, label: `${describe} on ${plural(count.value)}` });

  // Left out of the tree, not hidden: \`visible={false}\` keeps a node's
  // space, and the list would end 53px above the window's edge.
  const bar = () => (
    <column key="bar" role="toolbar" label="Selected issues" ref={node => (barNode = node)}>
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
  return <column>{count.pipe(map(n => n > 0), distinctUntilChanged(), map(shown => (shown ? [bar()] : [])))}</column>;
}
