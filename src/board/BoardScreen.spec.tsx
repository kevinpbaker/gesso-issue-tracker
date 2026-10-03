import { afterEach, describe, expect, it } from 'vitest';

import { percent, shortcuts } from 'gesso-core';
import { createComponent, ServiceRegistry, type ComponentContext, type Inputs } from 'gesso-framework';
import { renderTest, serveForTest, textProperty, type Rendered, type ServedForTest } from 'gesso-testing';

import { ShortcutsService } from '../app/ShortcutsService';
import { IssueStore } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';
import { Board } from './BoardContract';
import { BoardScreen } from './BoardScreen';
import { boardSource } from './boardSource';
import { createBoardStore, type BoardStore } from './BoardStore';

/**
 * The board without a mouse: Phase 4's exit criterion. Every move is
 * made with the keys a person would press, read back from the store,
 * and every step is checked against what the live region says.
 */

function Harness(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const { registry } = ctx.inject(ShortcutsService);
  return (
    <column width={percent(100)} height={percent(100)} modifiers={[shortcuts({ registry })]}>
      <BoardScreen />
    </column>
  );
}

interface Mounted {
  ui: Rendered;
  served: ServedForTest;
  store: IssueStore;
  board: BoardStore;
}

let h: Mounted;
afterEach(() => {
  h?.ui.unmount();
  h?.served.dispose();
});

async function mount(): Promise<void> {
  const store = new IssueStore(seedWorkspace({ issues: 300 }));
  const board = createBoardStore(store);
  const served = serveForTest([{ token: Board, source: boardSource(board) }]);
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  const ui = renderTest(createComponent(Harness), { channels: served.registry, width: 1600, height: 900, services });
  h = { ui, served, store, board };
  await settle();
}

async function settle(): Promise<void> {
  await h.ui.settle();
  await h.served.settle();
  await h.ui.settle();
}

async function press(key: string): Promise<void> {
  h.ui.fireEvent.press(key);
  await settle();
}

const said = () => textProperty(h.ui.getByRole('status')) ?? '';

describe('the board from the keyboard', () => {
  it('moves a card to the next column, announcing each step', async () => {
    await mount();
    const [first, second] = h.board.orderOf('backlog');
    await press('ArrowDown');
    expect(said()).toMatch(/Backlog, 2 of \d+$/);
    await press(' ');
    expect(said()).toMatch(/^Picked up /);
    await press('ArrowRight');
    expect(said()).toMatch(/^Todo, position 2 of \d+$/);
    await press(' ');
    expect(said()).toMatch(/^Dropped .+ in Todo, position 2\.$/);
    expect(h.store.get(second!)!.stateId).toBe('todo');
    expect(h.board.orderOf('todo')[1]).toBe(second);
    expect(h.board.orderOf('backlog')[0]).toBe(first);
  });

  it('puts the card back on Escape, and nothing changes', async () => {
    await mount();
    const before = [...h.board.orderOf('backlog')];
    await press(' ');
    await press('ArrowDown');
    await press('ArrowDown');
    await press('Escape');
    expect(said()).toMatch(/^Cancelled\. .+ is back where it was\.$/);
    expect(h.board.orderOf('backlog')).toEqual(before);
    expect(h.store.canUndo).toBe(false);
  });

  it('reorders within a column, and one undo puts it back', async () => {
    await mount();
    const before = [...h.board.orderOf('backlog')];
    await press(' ');
    await press('ArrowDown');
    await press('ArrowDown');
    await press(' ');
    expect(h.board.orderOf('backlog').slice(0, 3)).toEqual([before[1], before[0], before[2]]);
    h.store.undo();
    await settle();
    expect(h.board.orderOf('backlog')).toEqual(before);
  });

  it('exposes the announcements as a status a screen reader hears', async () => {
    await mount();
    await press('ArrowDown');
    expect(h.ui.getByRole('status')).toBeTruthy();
  });
});

describe('the board for a screen reader', () => {
  it('is one tab stop whose active descendant is the card under the cursor', async () => {
    await mount();
    const board = h.ui.getByRole('group', { name: 'Board' });
    h.ui.fireEvent.focus(board);
    await settle();
    const active = () => {
      const id = h.ui.getSemantics(board).activeDescendant;
      return id === undefined ? undefined : h.ui.getSemantics(h.ui.getAllByRole('listitem').find(node => node.id === id)!).label;
    };
    const first = active();
    expect(first).toMatch(/^[A-Z]+-\d+ /);
    await press('j');
    expect(active()).not.toBe(first);
    expect(h.ui.getSemantics(board).description).toContain('Space picks a card up');
    expect(h.ui.getAllByRole('list').length).toBeGreaterThanOrEqual(5);
  });

  it('starts a drag where the column was scrolled to, without jumping back to the cursor', async () => {
    await mount();
    const column = h.ui.getAllByRole('list')[0]!;
    const box = h.ui.getVisibleBox(column);
    h.ui.fireEvent.wheel({ x: box.x + box.width / 2, y: box.y + 200, deltaY: 1500 });
    await settle();
    await settle();
    // A card on screen, well down the column, where the cursor isn't.
    const card = h.ui
      .getAllByRole('listitem')
      .filter(node => node.parent !== null && h.ui.getVisibleBox(node).y > box.y && h.ui.getVisibleBox(node).y + 100 < box.y + box.height)
      .find(node => { let at = node.parent; while (at !== null && at !== column) at = at.parent; return at === column; })!;
    const before = h.ui.getVisibleBox(card);
    const name = h.ui.getSemantics(card).label;
    const x = before.x + before.width / 2;
    const y = before.y + before.height / 2;
    h.ui.fireEvent.pointerDown(x, y);
    for (let step = 1; step <= 6; step++) {
      h.ui.fireEvent.pointerMove(x + step * 60, y);
      await settle();
    }
    // Still where it was pressed: the column didn't scroll back to its top.
    expect(h.ui.getVisibleBox(h.ui.getByRole('listitem', { name: name! })).y).toBe(before.y);
    h.ui.fireEvent.pointerUp(x + 360, y);
    await settle();
  });
});
