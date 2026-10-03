import { combineLatest, type Observable } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';

import { autoFocus, dragSource, draggable, dropTarget, focusRing, LazyColumn, percent, scrollPosition, shortcut, type UiNode } from 'gesso-core';
import { Select } from 'gesso-components';
import { FocusService, internalState, RouterService, type ComponentContext, type Inputs, type RouteMatch } from 'gesso-framework';

import { ShortcutsService } from '../app/ShortcutsService';
import { ListPlaces } from '../issues/ListPlaces';
import { triageKeys } from '../issues/triageKeys';
import { Probe } from '../ui/probe';
import { ALL_LANE, Board, cellKey, slotKey, type CardRow, type LaneField, type LaneRow } from './BoardContract';

/**
 * The board: a column per workflow state, optionally split into
 * swimlanes by assignee or project, every cell a virtualized list.
 *
 * Nothing here holds an issue. Each cell tells the app worker which
 * rows it can see, and each mounted card reads its own slot out of the
 * published window.
 *
 * Everything a pointer can do, the keyboard can too. The arrows (or
 * h j k l) move a cursor between cards, PageUp and PageDown between
 * lanes, Space picks the card up, the arrows carry it, Space puts it
 * down and Escape puts it back. Every step is announced through a
 * live region, and the drop indicator shows where it will land, for
 * the pointer and the keyboard alike.
 *
 * The list's triage keys work on the card under the cursor: s, a, p and
 * i, and Shift+L for labels, since l is the next column here.
 *
 * A card opened is stepped from with the issue page's j and k, through
 * the board read column by column; Escape there comes back to the board
 * with the cursor on the card shown last (`ListPlaces`).
 */

/**
 * Every row is exactly this tall, so a cell's window is arithmetic: a
 * 3 px drop line above and below, and a card of a fixed height between
 * them that clips rather than grows, whatever its title wraps to.
 */
export const CARD = 112;
const LINE = 3;
const CARD_BODY = 94;
const COLUMN = 280;
/** How tall a cell is inside a swimlane; with lanes off, cells fill the board. */
const LANE_CELL = 336;
/** Rows a cell can plausibly show at once; the store adds overscan. */
const VISIBLE = 16;

export const CARD_TYPE = 'board/card';

interface CardPayload {
  readonly id: string;
}

/** A card position: which lane, which state, which row. */
export interface Spot {
  readonly lane: string;
  readonly stateId: string;
  readonly index: number;
}

interface Picked {
  readonly id: string;
  readonly key: string;
  readonly from: Spot;
  readonly to: Spot;
}

/** Hoisted: modifier arguments are compared by identity. */
const DRAG = draggable({ keepOffset: false, dragging: { lift: true, opacity: 0.9, zIndex: 10 } });

const LANE_OPTIONS = [
  { value: 'none', label: 'No swimlanes' },
  { value: 'assignee', label: 'By assignee' },
  { value: 'project', label: 'By project' }
];

/** The shared state every cell and card reads: where the cursor is, what is carried, where it would land. */
interface BoardState {
  readonly cursor: ReturnType<typeof internalState<Spot | null>>;
  readonly hint: ReturnType<typeof internalState<Spot | null>>;
  readonly picked: ReturnType<typeof internalState<Picked | null>>;
  /** The cards on screen, by slot, for the board's active descendant. */
  readonly cards: Map<string, UiNode>;
  readonly cardsChanged: ReturnType<typeof internalState<number>>;
}

/** Where keyboard focus is, when it's on the board. One value, so it's never re-attached. */
const BOARD_FOCUS = focusRing();
const BOARD_KEYS =
  'Arrows move between cards, Page Up and Page Down between lanes. Space picks a card up and puts it down, Enter opens it. S sets its status, A its assignee, P its priority, Shift+L its labels, and I assigns it to you.';

export function BoardScreen(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const board = ctx.channel(Board);
  const router = ctx.inject(RouterService);
  const { registry } = ctx.inject(ShortcutsService);

  const state: BoardState = {
    cursor: internalState<Spot | null>(null),
    hint: internalState<Spot | null>(null),
    picked: internalState<Picked | null>(null),
    cards: new Map(),
    cardsChanged: internalState(0)
  };
  // The board takes focus as it opens, often before its cards arrive:
  // the cursor goes to the first card when the board has focus and the
  // cards are there, whichever came second.
  const focus = ctx.inject(FocusService);
  let boardNode: UiNode | null = null;
  ctx.effect(combineLatest([focus.focused, board.view.lanes]), ([focused]) => {
    if (focused !== null && focused === boardNode && state.cursor.value === null) {
      state.cursor.value = first();
    }
  });
  // The card under the cursor, which a screen reader reads as the board's focus.
  const cursorCard = combineLatest([state.cursor, state.cardsChanged]).pipe(
    map(([at]) => (at === null ? null : (state.cards.get(slotKey(at.lane, at.stateId, at.index)) ?? null))),
    distinctUntilChanged()
  );
  const announcement = internalState('');

  const lanes = () => board.view.lanes.value;
  const states = () => board.view.columns.value;
  const countOf = (lane: string, stateId: string) => lanes().find(l => l.key === lane)?.counts[stateId] ?? 0;
  const stateName = (stateId: string) => states().find(s => s.id === stateId)?.name ?? stateId;
  const laneLabel = (lane: string) => (lane === ALL_LANE ? '' : `, ${lanes().find(l => l.key === lane)?.label ?? lane}`);
  const cardAt = (spot: Spot): CardRow | undefined => board.view.slots.value[slotKey(spot.lane, spot.stateId, spot.index)];

  const describe = (spot: Spot): string => {
    const row = cardAt(spot);
    const where = `${stateName(spot.stateId)}${laneLabel(spot.lane)}, ${spot.index + 1} of ${countOf(spot.lane, spot.stateId)}`;
    return row === undefined ? where : `${row.key} ${row.title}. ${where}`;
  };

  /** The first card on the board, for a cursor that has nowhere to start from. */
  const first = (): Spot | null => {
    for (const lane of lanes()) {
      for (const column of states()) {
        if ((lane.counts[column.id] ?? 0) > 0) return { lane: lane.key, stateId: column.id, index: 0 };
      }
    }
    return null;
  };

  /** Moves the cursor, or the carried card's destination, by a step in some direction. */
  const step = (dx: number, dy: number, dLane: number): void => {
    const carried = state.picked.value;
    const from = carried?.to ?? state.cursor.value ?? first();
    if (from === null) return;
    const laneKeys = lanes().map(l => l.key);
    const stateKeys = states().map(s => s.id);
    const lane = laneKeys[Math.max(0, Math.min(laneKeys.length - 1, laneKeys.indexOf(from.lane) + dLane))] ?? from.lane;
    const stateId = stateKeys[Math.max(0, Math.min(stateKeys.length - 1, stateKeys.indexOf(from.stateId) + dx))] ?? from.stateId;
    // A carried card may go one past the last card: the end of the cell.
    const own = carried !== null && carried.from.lane === lane && carried.from.stateId === stateId;
    const limit = carried === null || own ? countOf(lane, stateId) - 1 : countOf(lane, stateId);
    const index = Math.max(0, Math.min(Math.max(0, limit), from.index + dy));
    const next = { lane, stateId, index };
    if (carried !== null) {
      state.picked.value = { ...carried, to: next };
      state.hint.value = next;
      announcement.value = `${stateName(stateId)}${laneLabel(lane)}, position ${index + 1} of ${limit + 1}`;
    } else {
      state.cursor.value = next;
      announcement.value = describe(next);
    }
  };

  const pickOrDrop = (): void => {
    const carried = state.picked.value;
    if (carried !== null) {
      board.send.move({ id: carried.id, lane: carried.to.lane, stateId: carried.to.stateId, index: carried.to.index });
      state.picked.value = null;
      state.hint.value = null;
      // The card now sits where it was dropped, counted after its removal.
      const sameCell = carried.from.lane === carried.to.lane && carried.from.stateId === carried.to.stateId;
      const landed = sameCell && carried.from.index < carried.to.index ? carried.to.index - 1 : carried.to.index;
      state.cursor.value = { ...carried.to, index: landed };
      announcement.value = `Dropped ${carried.key} in ${stateName(carried.to.stateId)}${laneLabel(carried.to.lane)}, position ${landed + 1}.`;
      return;
    }
    const at = state.cursor.value ?? first();
    const row = at === null ? undefined : cardAt(at);
    if (at === null || row === undefined) return;
    state.cursor.value = at;
    state.picked.value = { id: row.id, key: row.key, from: at, to: at };
    state.hint.value = at;
    announcement.value = `Picked up ${row.key}. Arrow keys move it, Space drops it, Escape puts it back.`;
  };

  const cancel = (): void => {
    const carried = state.picked.value;
    if (carried === null) return;
    state.picked.value = null;
    state.hint.value = null;
    state.cursor.value = carried.from;
    announcement.value = `Cancelled. ${carried.key} is back where it was.`;
  };

  const open = (): void => {
    const at = state.cursor.value;
    const row = at === null ? undefined : cardAt(at);
    if (row !== undefined && state.picked.value === null) router.navigate(`/issue/${row.key}`);
  };

  const key = (keys: string, label: string, run: () => void) => shortcut({ registry, keys, label, scoped: false, group: 'Board', run });

  // Not while a card is carried: its move is still being decided.
  const triage = triageKeys(ctx, {
    group: 'Board',
    labelsKey: 'Shift+L',
    labelsNote: ' (Shift+L, as l is the next column)',
    target: () => {
      const at = state.cursor.value;
      const row = at === null ? undefined : cardAt(at);
      if (at === null || row === undefined || state.picked.value !== null) return null;
      return {
        ids: [row.id],
        name: row.key,
        now: { stateId: at.stateId, priority: row.priority, assigneeId: row.assigneeId, labels: row.labels },
        anchor: state.cards.get(slotKey(at.lane, at.stateId, at.index)) ?? null
      };
    }
  });

  // Switching lanes or teams changes every cell, so a cursor or a
  // carried card from the old arrangement points at nothing.
  ctx.effect(board.view.laneField.pipe(distinctUntilChanged()), () => {
    state.cursor.value = null;
    state.picked.value = null;
    state.hint.value = null;
  });

  // What the issue page steps through, and where its Escape comes back
  // to: this board, with the cursor on the card it last showed.
  const places = ctx.inject(ListPlaces);
  const mine = router.match.value?.route;
  ctx.effect(router.match.pipe(filter((match): match is RouteMatch => match !== null && match.route === mine)), match => {
    places.origin = { url: match.url, list: { kind: 'board' } };
    const landing = places.takeBoardLanding(match.path);
    if (landing !== undefined) state.cursor.value = landing;
  });

  return (
    <column
      width={percent(100)}
      height={percent(100)}
      minWidth={0}
      backgroundColor="background"
      modifiers={[
        key('ArrowDown', 'Next card', () => step(0, 1, 0)),
        key('j', 'Next card', () => step(0, 1, 0)),
        key('ArrowUp', 'Previous card', () => step(0, -1, 0)),
        key('k', 'Previous card', () => step(0, -1, 0)),
        key('ArrowRight', 'Next column', () => step(1, 0, 0)),
        key('l', 'Next column', () => step(1, 0, 0)),
        key('ArrowLeft', 'Previous column', () => step(-1, 0, 0)),
        key('h', 'Previous column', () => step(-1, 0, 0)),
        key('PageDown', 'Next lane', () => step(0, 0, 1)),
        key('PageUp', 'Previous lane', () => step(0, 0, -1)),
        key('Space', 'Pick up or drop the card', pickOrDrop),
        key('Escape', 'Put the card back', cancel),
        key('Enter', 'Open the card', open),
        ...triage.modifiers
      ]}>
      <row height={44} paddingLeft={16} paddingRight={16} gap={12} y="center">
        <text
          text={board.view.columns.pipe(map(columns => `${columns.reduce((sum, c) => sum + c.count, 0).toLocaleString('en-US')} issues`))}
          fontSize={12}
          color="textMuted"
          flexGrow={1}
        />
        <Select
          label="Swimlanes"
          compact={true}
          value={board.view.laneField}
          options={LANE_OPTIONS}
          onChange={next => board.send.setLanes(next as LaneField)}
        />
      </row>
      {/* No label: a live region speaks its name, and named here it would
          say "Board announcements" every time rather than what happened. */}
      <text text={announcement} role="status" live="polite" height={0} opacity={0} />
      {triage.picker}
      {/* A row that overflows scrolls sideways, so five columns fit any width. */}
      {/* One tab stop: the cards are walked with the cursor, and the one
          under it is the board's active descendant. */}
      <row
        overflow="scroll"
        flexGrow={1}
        flexBasis={0}
        minWidth={0}
        width={percent(100)}
        label="Board"
        role="group"
        description={BOARD_KEYS}
        focusable={true}
        activeDescendant={cursorCard}
        // The board opened is the board to start on.
        modifiers={[BOARD_FOCUS, autoFocus()]}
        ref={(node: UiNode | null) => (boardNode = node)}>
        <column padding={12} paddingTop={0} gap={8}>
          <row gap={12}>
            {board.view.columns.pipe(
              map(columns =>
                columns.map(column => (
                  <row
                    key={column.id}
                    width={COLUMN}
                    flexShrink={0}
                    height={32}
                    paddingLeft={12}
                    paddingRight={12}
                    x="space-between"
                    y="center"
                    borderRadius={8}
                    backgroundColor="surface">
                    <text text={column.name} fontSize={13} fontWeight={600} color="text" />
                    <text text={column.count.toLocaleString('en-US')} fontSize={12} color="textMuted" />
                  </row>
                ))
              )
            )}
          </row>
          {board.view.laneField.pipe(
            map(field =>
              field === 'none' ? (
                <LaneCells key="flat" lane={ALL_LANE} height={null} state={state} />
              ) : (
                <scrollview key={`lanes-${field}`} flexGrow={1} flexBasis={0} label="Swimlanes">
                  <column gap={16}>
                    {board.view.lanes.pipe(map(all => all.map(lane => <Lane key={lane.key} lane={lane} state={state} />)))}
                  </column>
                </scrollview>
              )
            )
          )}
        </column>
      </row>
    </column>
  );
}

function Lane(inputs: Inputs<{ lane: LaneRow; state: BoardState }>, _ctx: ComponentContext) {
  const lane = inputs.lane;
  return (
    <column gap={8} role="group" label={lane.pipe(map(l => `${l.label}, ${l.total} issues`))}>
      <row gap={8} y="center" height={28} paddingLeft={4}>
        <text text={lane.pipe(map(l => l.label))} fontSize={13} fontWeight={600} color="text" />
        <text text={lane.pipe(map(l => l.total.toLocaleString('en-US')))} fontSize={12} color="textMuted" />
      </row>
      <LaneCells lane={lane.value.key} height={LANE_CELL} state={inputs.state.value} />
    </column>
  );
}

function LaneCells(inputs: Inputs<{ lane: string; height: number | null; state: BoardState }>, ctx: ComponentContext) {
  const board = ctx.channel(Board);
  return (
    <row gap={12} flexGrow={inputs.height.value === null ? 1 : 0} y="stretch">
      {board.view.columns.pipe(
        map(columns =>
          columns.map(column => (
            <Cell key={column.id} lane={inputs.lane.value} stateId={column.id} height={inputs.height.value} state={inputs.state.value} />
          ))
        )
      )}
    </row>
  );
}

function Cell(inputs: Inputs<{ lane: string; stateId: string; height: number | null; state: BoardState }>, ctx: ComponentContext) {
  const board = ctx.channel(Board);
  const lane = inputs.lane.value;
  const stateId = inputs.stateId.value;
  const state = inputs.state.value;
  const key = cellKey(lane, stateId);
  const count = board.view.lanes.pipe(
    map(lanes => lanes.find(l => l.key === lane)?.counts[stateId] ?? 0),
    distinctUntilChanged()
  );
  const scrollY = internalState(0);
  const probe = new Probe();

  let start = -1;
  const report = (offsetY: number): void => {
    const firstRow = Math.max(0, Math.floor(offsetY / CARD));
    if (firstRow !== start) {
      start = firstRow;
      board.send.setWindow({ lane, stateId, start: firstRow, end: firstRow + VISIBLE });
    }
  };
  report(0);

  /** Scrolls just enough to show a row, for the keyboard cursor and a carried card. */
  const reveal = (index: number): void => {
    const top = index * CARD;
    const height = probe.box()?.height ?? 600;
    if (top < scrollY.value) scrollY.value = top;
    else if (top + CARD > scrollY.value + height) scrollY.value = top + CARD - height;
  };
  // Each when it moves, and only then: revealing `hint ?? cursor` on
  // every change of either brought the cursor back into view whenever a
  // drag's hint came or went, which scrolled a column to its top under
  // the pointer as a drag started in it.
  const sameSpot = (a: Spot | null, b: Spot | null) =>
    a === b || (a !== null && b !== null && a.lane === b.lane && a.stateId === b.stateId && a.index === b.index);
  const revealHere = (spot: Spot | null): void => {
    if (spot !== null && spot.lane === lane && spot.stateId === stateId) reveal(spot.index);
  };
  ctx.effect(state.cursor.pipe(distinctUntilChanged(sameSpot)), revealHere);
  ctx.effect(state.hint.pipe(distinctUntilChanged(sameSpot)), revealHere);

  let total = 0;
  ctx.effect(count, value => (total = value));
  const indexAt = (y: number): number => {
    const box = probe.box();
    return box === null ? total : Math.max(0, Math.min(total, Math.round((y - box.y + scrollY.value) / CARD)));
  };

  const list = LazyColumn(
    {
      flexGrow: inputs.height.value === null ? 1 : 0,
      height: inputs.height.value ?? undefined,
      count,
      revision: board.view.revisions.pipe(
        map(revisions => revisions[key] ?? 0),
        distinctUntilChanged()
      ),
      estimatedExtent: CARD,
      scrollY,
      role: 'list',
      // "Todo, Ada Okafor, 12 cards": the column, the lane when there are
      // lanes, and how many.
      label: combineLatest([board.view.columns, board.view.lanes, count]).pipe(
        map(([columns, lanes, cards]) => {
          const column = columns.find(c => c.id === stateId)?.name ?? stateId;
          const laneName = lane === ALL_LANE ? '' : `, ${lanes.find(l => l.key === lane)?.label ?? lane}`;
          return `${column}${laneName}, ${cards} ${cards === 1 ? 'card' : 'cards'}`;
        })
      ),
      modifiers: [
        scrollPosition({
          onChange: offset => {
            scrollY.value = offset.y;
            report(offset.y);
          }
        }),
        probe.modifier,
        // The cell is the only drop zone, and works out where in it the
        // card lands from the pointer: every card is the same height, so
        // the arithmetic is exact and one zone draws one indicator.
        dropTarget({
          accepts: CARD_TYPE,
          onOver: (_payload, at) => (state.hint.value = { lane, stateId, index: indexAt(at.y) }),
          onLeave: () => {
            const hint = state.hint.value;
            if (hint !== null && hint.lane === lane && hint.stateId === stateId && state.picked.value === null) {
              state.hint.value = null;
            }
          },
          onDrop: (payload, at) => {
            state.hint.value = null;
            board.send.move({ id: (payload.data as CardPayload).id, lane, stateId, index: indexAt(at.y) });
          },
          over: { backgroundColor: 'controlBackgroundHovered' },
          autoScroll: { edge: 56, speed: 900 }
        })
      ]
    },
    index => <Card lane={lane} stateId={stateId} index={index} count={count} state={state} />
  );

  return (
    <column width={COLUMN} flexShrink={0} borderRadius={10} backgroundColor="surface" padding={8}>
      {list}
    </column>
  );
}

function Card(
  inputs: Inputs<{ lane: string; stateId: string; index: number; count: number; state: BoardState }>,
  ctx: ComponentContext
) {
  const board = ctx.channel(Board);
  const router = ctx.inject(RouterService);
  const lane = inputs.lane.value;
  const stateId = inputs.stateId.value;
  const index = inputs.index.value;
  const state = inputs.state.value;
  const key = slotKey(lane, stateId, index);
  const slot: Observable<CardRow | undefined> = board.view.slots.pipe(
    map(slots => slots[key]),
    distinctUntilChanged()
  );
  const field = <T,>(read: (row: CardRow) => T, empty: T) => slot.pipe(map(row => (row === undefined ? empty : read(row))));
  const here = (spot: Spot | null, at = index) => spot !== null && spot.lane === lane && spot.stateId === stateId && spot.index === at;
  const atCursor = state.cursor.pipe(
    map(cursor => here(cursor)),
    distinctUntilChanged()
  );
  const carried = combineLatest([state.picked, slot]).pipe(
    map(([picked, row]) => picked !== null && row !== undefined && picked.id === row.id),
    distinctUntilChanged()
  );
  // The indicator sits above the card at the drop index, or below the
  // last card when the drop is at the end of the cell.
  const lineAbove = state.hint.pipe(
    map(hint => here(hint)),
    distinctUntilChanged()
  );
  const lineBelow = combineLatest([state.hint, inputs.count]).pipe(
    map(([hint, count]) => index === count - 1 && here(hint, count)),
    distinctUntilChanged()
  );

  return (
    <column height={CARD} x="stretch">
      <box height={LINE} flexShrink={0} borderRadius={2} marginBottom={2} backgroundColor={lineAbove.pipe(map(on => (on ? 'primary' : 'surface')))} />
      <column
        height={CARD_BODY}
        flexShrink={0}
        overflow="hidden"
        gap={6}
        padding={10}
        borderRadius={8}
        borderWidth={atCursor.pipe(map(on => (on ? 2 : 1)))}
        borderColor={combineLatest([atCursor, carried]).pipe(map(([on, lifted]) => (on || lifted ? 'primary' : 'border')))}
        backgroundColor="background"
        opacity={carried.pipe(map(lifted => (lifted ? 0.5 : 1)))}
        cursor="grab"
        role="listitem"
        ref={(node: UiNode | null) => {
          if (node === null) state.cards.delete(key);
          else state.cards.set(key, node);
          state.cardsChanged.value += 1;
        }}
        label={field(row => `${row.key} ${row.title}`, 'Loading card')}
        // The cursor goes to the card pressed, before the press gives the
        // board focus: a board focused with no cursor puts it on the first
        // card and scrolls that column to its top, out from under the
        // pointer and whatever drag it was starting.
        onPointerDown={() => (state.cursor.value = { lane, stateId, index })}
        onClick={() => {
          const row = board.view.slots.value[key];
          if (row !== undefined) router.navigate(`/issue/${row.key}`);
        }}
        modifiers={[
          DRAG,
          dragSource({
            payload: () => ({ type: CARD_TYPE, data: { id: board.view.slots.value[key]?.id ?? '' } satisfies CardPayload }),
            onEnd: () => (state.hint.value = null)
          })
        ]}>
        <row x="space-between" y="center">
          <text text={field(row => row.key, '')} fontSize={11} color="textMuted" />
          <text text={field(row => row.initials, '')} fontSize={11} fontWeight={600} color="textMuted" />
        </row>
        <text text={field(row => row.title, '')} fontSize={13} color="text" maxLines={2} />
        <text text={field(row => row.labels.join(' · '), '')} fontSize={11} color="textMuted" maxLines={1} />
      </column>
      <box height={LINE} flexShrink={0} borderRadius={2} marginTop={2} backgroundColor={lineBelow.pipe(map(on => (on ? 'primary' : 'surface')))} />
    </column>
  );
}
