import { BehaviorSubject, combineLatest, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import type { BoardStore } from '../board/BoardStore';
import type { IssueStore } from '../model/IssueStore';
import { runQuery } from '../model/query';
import type { SearchIndex } from '../search/SearchIndex';
import { localDay } from '../issues/IssueQueryService';
import type { StepList, StepPosition } from './StepsContract';

/**
 * Where the open issue sits in the list it was opened from: the app
 * worker's half of the issue page's j and k.
 *
 * Its own query, apart from the list's, so working out the neighbours
 * never touches the list's selection or window. It runs only while an
 * issue page is asking, and again on each change, as the list's does.
 *
 * Which list counts is settled when an issue is first asked about, and
 * kept: an edit that takes the issue out of the list it came from
 * doesn't move it to another one, it leaves it where it was, with the
 * neighbours it had, so j still goes on to the issue that was next.
 */
export class StepService {
  private readonly request = new BehaviorSubject<{ readonly key: string; readonly lists: readonly StepList[] } | null>(null);
  /** The list settled on for the issue asked about, and where in it the issue was last. */
  private chosen = -1;
  private last = 0;
  /** The answer `follow` worked out, for the store version it read. */
  private settled: { readonly version: number; readonly at: StepPosition | null } | null = null;

  readonly at: Observable<StepPosition | null>;

  constructor(
    private readonly store: IssueStore,
    private readonly board: BoardStore,
    private readonly search?: SearchIndex,
    private readonly clock: () => number = Date.now
  ) {
    this.at = combineLatest([this.request, store.version]).pipe(
      map(([request, version]) => {
        if (request === null) return null;
        if (this.settled?.version === version) return this.settled.at;
        return this.locate(request.key, request.lists);
      })
    );
  }

  /** Settles which list counts now, as the issue is asked about, whether or not anything is listening yet. */
  follow(key: string, lists: readonly StepList[]): void {
    this.chosen = -1;
    this.last = 0;
    this.settled = { version: this.store.version.value, at: this.locate(key, lists) };
    this.request.next({ key, lists });
  }

  stop(): void {
    this.settled = null;
    if (this.request.value !== null) this.request.next(null);
  }

  private locate(key: string, lists: readonly StepList[]): StepPosition | null {
    const issue = this.store.byKey(key);
    if (issue === undefined || lists.length === 0) return null;
    let index = -1;
    let read: Ordered = { ids: [], cards: null };
    if (this.chosen === -1) {
      // The first list that has it; the last, the team's, when none does.
      for (let at = 0; at < lists.length && index === -1; at += 1) {
        read = this.order(lists[at]!);
        index = read.ids.indexOf(issue.id);
        this.chosen = at;
      }
    } else {
      read = this.order(lists[Math.min(this.chosen, lists.length - 1)]!);
      index = read.ids.indexOf(issue.id);
    }
    const { ids, cards } = read;
    const within = index !== -1;
    if (within) this.last = index;
    const at = within ? index : Math.min(this.last, ids.length);
    const keyAt = (position: number): string | null => {
      const id = ids[position];
      return id === undefined ? null : (this.store.get(id)?.key ?? null);
    };
    const card = within ? cards?.[index] : undefined;
    return {
      key,
      list: this.chosen,
      index: at,
      within,
      total: ids.length,
      previous: at > 0 ? keyAt(at - 1) : null,
      // Out of the list, the issue that slid into its place is next.
      next: keyAt(within ? at + 1 : at),
      spot: card === undefined ? null : { lane: card.lane, stateId: card.stateId, index: card.index }
    };
  }

  /** A list's issues in order; for the board, where each card sits too. */
  private order(list: StepList): Ordered {
    if (list.kind === 'board') {
      const cards = this.board.cardsInOrder();
      return { ids: cards.map(card => card.id), cards };
    }
    const now = this.clock();
    const result = runQuery(this.store.workspace, this.store.issues(), list.query, {
      search: this.search === undefined ? undefined : text => this.search!.search(text),
      now,
      today: localDay(now)
    });
    return { ids: result.ids, cards: null };
  }
}

interface Ordered {
  readonly ids: readonly string[];
  readonly cards: ReturnType<BoardStore['cardsInOrder']> | null;
}
