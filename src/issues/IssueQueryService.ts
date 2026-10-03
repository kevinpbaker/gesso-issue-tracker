import { BehaviorSubject, combineLatest, merge } from 'rxjs';
import { distinctUntilChanged, filter, map, scan, shareReplay, startWith } from 'rxjs/operators';

import type { IssueStore } from '../model/IssueStore';
import { DEFAULT_QUERY, runQuery, type IssueQuery, type QueryResult } from '../model/query';
import type { SearchIndex } from '../search/SearchIndex';
import type { Issue } from '../model/types';
import type { ChangeNotice, IssueRow, IssuesSummary, TriageChange } from './IssuesContract';
import { labelFor, triage } from './triage';

/**
 * One list's view of the workspace: a query, a window, and the rows in it.
 *
 * Plain RxJS over the store, so it runs in node. It re-runs the whole
 * query when the query or the store changes, which `query.spec.ts`
 * holds under 100 ms for 50,000 issues. Making it incremental is a
 * Phase 3 question, to be answered by measuring the list, not now.
 */

/** Rows past each end of the window that are published too. */
export const OVERSCAN = 20;

export class IssueQueryService {
  readonly query = new BehaviorSubject<IssueQuery>(DEFAULT_QUERY);
  private readonly range = new BehaviorSubject({ start: 0, end: 50 });
  private lastMs = 0;
  private last: QueryResult = { ids: [], groups: [] };
  private readonly selection = new BehaviorSubject<ReadonlySet<string>>(new Set());

  private readonly names: {
    readonly states: Map<string, string>;
    readonly users: Map<string, { name: string; initials: string }>;
    readonly labels: Map<string, string>;
    readonly projects: Map<string, string>;
  };

  readonly result;
  readonly summary;
  readonly window;
  readonly rows;
  readonly undoLabel;
  readonly lastChange;
  readonly selected;
  readonly selectedCount;

  constructor(
    private readonly store: IssueStore,
    private readonly search?: SearchIndex,
    private readonly clock: () => number = Date.now
  ) {
    const { workspace } = store;
    this.names = {
      states: new Map(workspace.states.map(state => [state.id, state.name])),
      users: new Map(
        workspace.users.map(user => [
          user.id,
          {
            name: user.name,
            initials: user.name
              .split(' ')
              .map(part => part[0])
              .join('')
              .slice(0, 2)
          }
        ])
      ),
      labels: new Map(workspace.labels.map(label => [label.id, label.name])),
      projects: new Map(workspace.projects.map(project => [project.id, project.name]))
    };

    this.result = combineLatest([this.query, store.version]).pipe(
      map(([query]): QueryResult => {
        const started = performance.now();
        const now = this.clock();
        const result = runQuery(workspace, store.issues(), query, {
          search: this.search === undefined ? undefined : text => this.search!.search(text),
          now,
          today: localDay(now)
        });
        this.last = result;
        this.lastMs = Math.round((performance.now() - started) * 10) / 10;
        return result;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.summary = this.result.pipe(
      map((result): IssuesSummary => ({ total: result.ids.length, groups: result.groups, queryMs: this.lastMs }))
    );

    const visible = combineLatest([this.result, this.range]).pipe(
      map(([result, range]) => {
        const from = Math.max(0, range.start - OVERSCAN);
        const to = Math.min(result.ids.length, range.end + OVERSCAN);
        return result.ids.slice(from, to).map((id, offset) => [from + offset, id] as const);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.window = visible.pipe(
      map(entries => Object.fromEntries(entries.map(([index, id]) => [String(index), id])) as Readonly<Record<string, string>>)
    );

    // Rows are re-read from the store on every version, but the differ
    // sends only the rows whose content actually changed.
    this.rows = combineLatest([visible, store.version]).pipe(
      map(([entries]) => {
        const out: Record<string, IssueRow> = {};
        for (const [, id] of entries) {
          const issue = store.get(id);
          if (issue !== undefined) {
            out[id] = this.row(issue);
          }
        }
        return out as Readonly<Record<string, IssueRow>>;
      })
    );

    this.selected = combineLatest([visible, this.selection]).pipe(
      map(([entries, selection]) => {
        const out: Record<string, true> = {};
        for (const [, id] of entries) {
          if (selection.has(id)) out[id] = true;
        }
        return out as Readonly<Record<string, true>>;
      })
    );
    this.selectedCount = this.selection.pipe(
      map(selection => selection.size),
      distinctUntilChanged()
    );

    this.undoLabel = store.version.pipe(
      map(() => store.undoLabel),
      distinctUntilChanged()
    );

    // Typing in a description saves at every pause, and a notice each
    // time would be noise; a reset leaves nothing to undo.
    this.lastChange = merge(
      store.history.pipe(filter(step => !step.typing)),
      store.reloaded.pipe(map(() => null))
    ).pipe(
      scan((last: ChangeNotice | null, step): ChangeNotice | null => (step === null ? null : { serial: (last?.serial ?? 0) + 1, kind: step.kind, label: step.label }), null),
      startWith(null)
    );
  }

  setQuery(query: IssueQuery): void {
    // A different filter is a different list, and a selection made in
    // the old one would act on issues nobody can see. Sorting, grouping
    // and folding keep it: the same issues, arranged differently.
    const shown = (q: IssueQuery) => JSON.stringify([q.filter, q.also ?? [], q.refine ?? {}]);
    if (shown(query) !== shown(this.query.value)) {
      this.clearSelection();
    }
    this.query.next(query);
  }

  select(ranges: readonly (readonly [number, number])[], mode: 'replace' | 'add' | 'toggle'): void {
    const ids = this.idsIn(ranges);
    const next = new Set(mode === 'replace' ? [] : this.selection.value);
    if (mode === 'toggle') {
      const on = ids.some(id => !next.has(id));
      for (const id of ids) on ? next.add(id) : next.delete(id);
    } else {
      for (const id of ids) next.add(id);
    }
    this.selection.next(next);
  }

  clearSelection(): void {
    if (this.selection.value.size > 0) this.selection.next(new Set());
  }

  selectedIds(): string[] {
    return [...this.selection.value];
  }

  /** Named as the triage keys name it when it's one of their properties: "Moved 3 issues to Done". */
  updateSelected(patch: Partial<Issue>, label: string): void {
    const ids = this.selectedIds();
    this.store.update(ids, patch, labelFor(this.store, ids, patch, label));
  }

  addLabelToSelected(labelId: string, label: string): void {
    const changes = this.selectedIds().flatMap(id => {
      const issue = this.store.get(id);
      if (issue === undefined || issue.labelIds.includes(labelId)) return [];
      return [{ kind: 'update' as const, id, before: { labelIds: issue.labelIds }, after: { labelIds: [...issue.labelIds, labelId] } }];
    });
    if (changes.length > 0) this.store.commit(label, changes);
  }

  /** One property to some issues, or to the selection without `ids`. */
  triage(ids: readonly string[] | undefined, change: TriageChange): void {
    triage(this.store, ids ?? this.selectedIds(), change);
  }

  setWindow(range: { readonly start: number; readonly end: number }): void {
    const current = this.range.value;
    if (current.start !== range.start || current.end !== range.end) {
      this.range.next({ start: range.start, end: range.end });
    }
  }

  /** The IDs a selection of the current result covers, in order, without duplicates. */
  idsIn(selection: readonly (readonly [number, number])[]): string[] {
    const seen = new Set<string>();
    for (const [from, to] of selection) {
      const start = Math.max(0, Math.min(from, to));
      const end = Math.min(this.last.ids.length - 1, Math.max(from, to));
      for (let index = start; index <= end; index += 1) seen.add(this.last.ids[index]!);
    }
    return [...seen];
  }

  row(issue: Issue): IssueRow {
    const user = issue.assigneeId === null ? undefined : this.names.users.get(issue.assigneeId);
    return {
      id: issue.id,
      key: issue.key,
      title: issue.title,
      stateId: issue.stateId,
      stateName: this.names.states.get(issue.stateId) ?? issue.stateId,
      priority: issue.priority,
      assigneeId: issue.assigneeId,
      assigneeName: user?.name ?? '',
      initials: user?.initials ?? '',
      labels: issue.labelIds.map(id => this.names.labels.get(id) ?? id),
      projectName: issue.projectId === null ? '' : (this.names.projects.get(issue.projectId) ?? ''),
      updatedAt: issue.updatedAt
    };
  }
}

/** The date in the local time zone, `YYYY-MM-DD`: what "today" means to the person looking. */
export function localDay(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
