import type { StepList } from '../detail/StepsContract';
import type { GroupField, SortField } from '../model/query';

/** How a list was arranged and where it was left: what its screen's own state was when it closed. */
export interface ListPlace {
  /** Which issues it showed (its filter and refinement), so a place isn't put back onto a different list. */
  readonly shown: string;
  readonly group: GroupField | null;
  readonly sort: SortField | null;
  readonly collapsed: readonly string[];
  readonly cursor: number;
  readonly scrollY: number;
}

/** A list or a board to step through, and the address that shows it. */
export interface StepOrigin {
  readonly url: string;
  readonly list: StepList;
}

/** Where on the board a card sits, for the board's cursor to come back to. */
export interface BoardLanding {
  readonly lane: string;
  readonly stateId: string;
  readonly index: number;
}

/**
 * Where each list was left, and which list or board was looked at last.
 *
 * A screen is made again every time it's opened, so whatever it keeps
 * in its own state (the cursor, the scroll, the grouping chosen from
 * the toolbar) goes when an issue is opened from it. This render-worker
 * service outlives them: a list writes its place here as it closes and
 * reads it back as it opens, keyed by its path, so a list left for an
 * issue comes back as it was.
 *
 * It also holds the issue page's half of the round trip: `origin` is
 * the list or board looked at last, which the issue page steps through
 * with j and k, and `land` is where Escape asks that list to put its
 * cursor, which may be an issue stepped to rather than the one opened.
 */
export class ListPlaces {
  private readonly places = new Map<string, ListPlace>();
  private readonly landings = new Map<string, number>();
  private readonly boardLandings = new Map<string, BoardLanding>();
  /** The list or board shown last, or the one being stepped through. */
  origin: StepOrigin | null = null;

  get(path: string): ListPlace | undefined {
    return this.places.get(path);
  }

  save(path: string, place: ListPlace): void {
    this.places.set(path, place);
  }

  /** Asks the list at `path` to open with its cursor on an issue, by its position in the list. */
  land(path: string, index: number): void {
    this.landings.set(path, index);
  }

  /** Where the list at `path` was asked to put its cursor, once: the list takes it as it opens. */
  takeLanding(path: string): number | undefined {
    const index = this.landings.get(path);
    this.landings.delete(path);
    return index;
  }

  landOnBoard(path: string, spot: BoardLanding): void {
    this.boardLandings.set(path, spot);
  }

  takeBoardLanding(path: string): BoardLanding | undefined {
    const spot = this.boardLandings.get(path);
    this.boardLandings.delete(path);
    return spot;
  }
}
