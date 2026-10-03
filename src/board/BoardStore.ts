import { BehaviorSubject, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';

import type { Change, IssueStore, Transaction } from '../model/IssueStore';
import type { Issue } from '../model/types';
import {
  ALL_LANE,
  cellKey,
  NO_LANE,
  slotKey,
  type CardRow,
  type ColumnRow,
  type LaneField,
  type LaneRow,
  type MoveRequest,
  type WindowRequest
} from './BoardContract';

/**
 * The board, as the app worker holds it: a view over the issue store.
 *
 * Each cell is the issues in one workflow state (and, with swimlanes,
 * one lane), ordered by `rank`. A move is one transaction on the store
 * that writes the issue's state, its lane's field (assignee or project)
 * and a rank between its new neighbours, so it is undoable from
 * anywhere in the app, persisted, and in the activity feed like any
 * other edit.
 *
 * Cell orders are cached and re-sorted only for the cells a transaction
 * touched, and each cell has its own revision, so a drop re-renders the
 * cells it changed rather than every mounted card on the board.
 */

/** How many rows past each end of a requested window are published too. */
export const OVERSCAN = 8;
/** Ranks closer than this are renumbered before a move lands between them. */
const MIN_GAP = 1e-6;

export function createBoardStore(store: IssueStore) {
  const { workspace } = store;
  const initials = new Map(
    workspace.users.map(user => [
      user.id,
      user.name
        .split(' ')
        .map(part => part[0])
        .join('')
        .slice(0, 2)
    ])
  );
  const labelNames = new Map(workspace.labels.map(label => [label.id, label.name]));
  const stateIds = workspace.states.map(state => state.id);

  /** Which team's board this is; null shows every team. */
  let teamId: string | null = null;
  let laneField: LaneField = 'none';
  const cells = new Map<string, string[]>();

  const laneOf = (issue: Pick<Issue, 'assigneeId' | 'projectId'>): string => {
    switch (laneField) {
      case 'none':
        return ALL_LANE;
      case 'assignee':
        return issue.assigneeId ?? NO_LANE;
      case 'project':
        return issue.projectId ?? NO_LANE;
    }
  };
  const visible = (issue: Issue): boolean => teamId === null || issue.teamId === teamId;
  const byRank = (a: Issue, b: Issue) => a.rank - b.rank || (a.id < b.id ? -1 : 1);

  const sortAll = (): void => {
    const buckets = new Map<string, Issue[]>();
    for (const issue of store.issues()) {
      if (!visible(issue)) continue;
      const key = cellKey(laneOf(issue), issue.stateId);
      let bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, (bucket = []));
      bucket.push(issue);
    }
    cells.clear();
    for (const [key, bucket] of buckets) {
      cells.set(key, bucket.sort(byRank).map(issue => issue.id));
    }
  };

  const sortCell = (key: string): void => {
    const bucket: Issue[] = [];
    for (const issue of store.issues()) {
      if (visible(issue) && cellKey(laneOf(issue), issue.stateId) === key) bucket.push(issue);
    }
    if (bucket.length === 0) cells.delete(key);
    else cells.set(key, bucket.sort(byRank).map(issue => issue.id));
  };

  sortAll();

  const revisions = new BehaviorSubject<Readonly<Record<string, number>>>({});
  const windows = new BehaviorSubject<Readonly<Record<string, { start: number; end: number }>>>({});
  const content = new BehaviorSubject(0);
  const shape = new BehaviorSubject(0);
  const field = new BehaviorSubject<LaneField>('none');

  const bump = (keys: Iterable<string>): void => {
    const next = { ...revisions.value };
    for (const key of keys) next[key] = (next[key] ?? 0) + 1;
    revisions.next(next);
  };
  const bumpAll = (): void => {
    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(revisions.value)) next[key] = value + 1;
    for (const key of cells.keys()) next[key] = (next[key] ?? 0) + 1;
    revisions.next(next);
  };

  /** The cells a transaction moved issues into, out of, or within. */
  const cellsOf = (transaction: Transaction): Set<string> => {
    const touched = new Set<string>();
    const ordering = ['stateId', 'rank', 'assigneeId', 'projectId', 'teamId'];
    for (const change of transaction.changes) {
      if (change.kind === 'update') {
        if (!ordering.some(name => name in change.after)) continue;
        const now = store.get(change.id);
        if (now === undefined) continue;
        const then = { ...now, ...change.before };
        touched.add(cellKey(laneOf(then), then.stateId));
        touched.add(cellKey(laneOf(now), now.stateId));
      } else if (change.kind === 'create' || change.kind === 'delete') {
        touched.add(cellKey(laneOf(change.issue), change.issue.stateId));
      }
    }
    return touched;
  };

  store.changes.subscribe(transaction => {
    const touched = cellsOf(transaction);
    const before = cells.size;
    touched.forEach(sortCell);
    if (touched.size > 0) bump(touched);
    if (cells.size !== before) shape.next(shape.value + 1);
    content.next(content.value + 1);
  });
  store.reloaded.subscribe(() => {
    sortAll();
    bumpAll();
    shape.next(shape.value + 1);
    content.next(content.value + 1);
  });

  const card = (id: string): CardRow => {
    const issue = store.get(id)!;
    return {
      id,
      key: issue.key,
      title: issue.title,
      priority: issue.priority,
      assigneeId: issue.assigneeId,
      initials: issue.assigneeId === null ? '' : (initials.get(issue.assigneeId) ?? ''),
      labels: issue.labelIds.map(labelId => labelNames.get(labelId) ?? labelId)
    };
  };

  const sizeOf = (lane: string, stateId: string) => cells.get(cellKey(lane, stateId))?.length ?? 0;

  const columns = combineLatest([revisions, shape]).pipe(
    map((): readonly ColumnRow[] =>
      workspace.states.map(state => {
        let count = 0;
        for (const [key, ids] of cells) if (key.endsWith(`|${state.id}`)) count += ids.length;
        return { id: state.id, name: state.name, count };
      })
    )
  );

  const people = new Map(workspace.users.map(user => [user.id, user.name]));
  const projects = new Map(workspace.projects.map(project => [project.id, project.name]));
  const laneLabel = (key: string): string => {
    if (key === ALL_LANE) return 'All issues';
    if (key === NO_LANE) return laneField === 'assignee' ? 'No assignee' : 'No project';
    return (laneField === 'assignee' ? people.get(key) : projects.get(key)) ?? key;
  };
  /** The lanes there are, top to bottom: by name, with the lane for nobody last. */
  const laneKeys = (): string[] => {
    const keys = new Set<string>();
    for (const key of cells.keys()) keys.add(key.slice(0, key.lastIndexOf('|')));
    if (laneField === 'none') keys.add(ALL_LANE);
    return [...keys].sort((a, b) => (a === NO_LANE ? 1 : b === NO_LANE ? -1 : laneLabel(a).localeCompare(laneLabel(b))));
  };

  const lanes = combineLatest([revisions, shape]).pipe(
    map((): readonly LaneRow[] =>
      laneKeys().map(key => {
        const counts: Record<string, number> = {};
        let total = 0;
        for (const stateId of stateIds) {
          counts[stateId] = sizeOf(key, stateId);
          total += counts[stateId]!;
        }
        return { key, label: laneLabel(key), counts, total };
      })
    )
  );

  const slots = combineLatest([windows, revisions, content]).pipe(
    map(([current]) => {
      const out: Record<string, CardRow> = {};
      for (const [key, window] of Object.entries(current)) {
        const ids = cells.get(key) ?? [];
        const bar = key.lastIndexOf('|');
        const lane = key.slice(0, bar);
        const stateId = key.slice(bar + 1);
        const from = Math.max(0, window.start - OVERSCAN);
        const to = Math.min(ids.length, window.end + OVERSCAN);
        for (let index = from; index < to; index += 1) {
          out[slotKey(lane, stateId, index)] = card(ids[index]!);
        }
      }
      return out as Readonly<Record<string, CardRow>>;
    })
  );

  /** A rank strictly between two neighbours, or null when they are too close to fit one. */
  function rankBetween(ids: readonly string[], index: number): number | null {
    const before = index > 0 ? store.get(ids[index - 1]!)!.rank : null;
    const after = index < ids.length ? store.get(ids[index]!)!.rank : null;
    if (before === null) return after === null ? 1024 : after - 1024;
    if (after === null) return before + 1024;
    return after - before < MIN_GAP ? null : (before + after) / 2;
  }

  /** What a card dropped into a lane takes from it: the lane's assignee or project. */
  function lanePatch(lane: string): Partial<Issue> {
    if (laneField === 'assignee') return { assigneeId: lane === NO_LANE ? null : lane };
    if (laneField === 'project') return { projectId: lane === NO_LANE ? null : lane };
    return {};
  }

  return {
    columns,
    lanes,
    laneField: field,
    slots,
    revisions,
    setTeam(next: string | null): void {
      if (next === teamId) return;
      teamId = next;
      sortAll();
      bumpAll();
      shape.next(shape.value + 1);
    },
    setLanes(next: LaneField): void {
      if (next === laneField) return;
      laneField = next;
      field.next(next);
      windows.next({});
      sortAll();
      bumpAll();
      shape.next(shape.value + 1);
    },
    setWindow(request: WindowRequest): void {
      const key = cellKey(request.lane, request.stateId);
      const previous = windows.value[key];
      if (previous !== undefined && previous.start === request.start && previous.end === request.end) return;
      windows.next({ ...windows.value, [key]: { start: request.start, end: request.end } });
    },
    move(request: MoveRequest): void {
      const issue = store.get(request.id);
      if (issue === undefined || !stateIds.includes(request.stateId)) return;
      const target = cells.get(cellKey(request.lane, request.stateId)) ?? [];
      const sameCell = laneOf(issue) === request.lane && issue.stateId === request.stateId;
      const fromIndex = sameCell ? target.indexOf(request.id) : -1;
      let index = Math.max(0, Math.min(request.index, target.length));
      if (fromIndex >= 0 && fromIndex < index) index -= 1;
      if (fromIndex === index) return;

      const others = target.filter(id => id !== request.id);
      const stateName = workspace.states.find(state => state.id === request.stateId)?.name ?? request.stateId;
      const label = sameCell
        ? `Reordered ${issue.key}`
        : issue.stateId === request.stateId
          ? `Moved ${issue.key} to another lane`
          : `Moved ${issue.key} to ${stateName}`;
      const patch: Partial<Issue> = { ...lanePatch(request.lane), stateId: request.stateId };
      const rank = rankBetween(others, index);
      if (rank !== null) {
        store.update([request.id], { ...patch, rank }, label);
        return;
      }
      // Rare: thousands of drops into one gap. Spread the cell out again
      // in the same transaction as the move, so one undo restores both
      // and the feed shows only the move.
      const changes: Change[] = others.map((id, position) => ({
        kind: 'update',
        id,
        before: { rank: store.get(id)!.rank },
        after: { rank: (position + 1) * 1024 }
      }));
      const before: Record<string, unknown> = { rank: issue.rank };
      for (const key of Object.keys(patch) as (keyof Issue)[]) before[key] = issue[key];
      changes.push({ kind: 'update', id: request.id, before: before as Partial<Issue>, after: { ...patch, rank: index * 1024 + 512 } });
      store.commit(label, changes);
    },
    undo(): void {
      store.undo();
    },
    /**
     * Every card, in the order the board is read as a list: lane by
     * lane, and in each lane column by column, top to bottom. What the
     * issue page's j and k step through after a card is opened.
     */
    cardsInOrder(): readonly { readonly id: string; readonly lane: string; readonly stateId: string; readonly index: number }[] {
      const out: { id: string; lane: string; stateId: string; index: number }[] = [];
      for (const lane of laneKeys()) {
        for (const stateId of stateIds) {
          (cells.get(cellKey(lane, stateId)) ?? []).forEach((id, index) => out.push({ id, lane, stateId, index }));
        }
      }
      return out;
    },
    /** For specs and the keyboard: the IDs of a cell, in order. */
    orderOf(stateId: string, lane: string = ALL_LANE): readonly string[] {
      return cells.get(cellKey(lane, stateId)) ?? [];
    }
  };
}

export type BoardStore = ReturnType<typeof createBoardStore>;
