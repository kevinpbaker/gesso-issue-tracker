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
