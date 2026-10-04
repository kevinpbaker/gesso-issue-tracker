import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { IssueStore } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';
import { cellKey, slotKey } from './BoardContract';
import { createBoardStore, OVERSCAN } from './BoardStore';
import { budget } from '../test/budget';

const make = (issues = 200) => {
  const store = new IssueStore(seedWorkspace({ issues }));
  return { store, board: createBoardStore(store) };
};

describe('the board store', () => {
  it('counts every issue into exactly one column', async () => {
    const { board } = make();
    const columns = await firstValueFrom(board.columns);
    expect(columns.reduce((sum, column) => sum + column.count, 0)).toBe(200);
  });

  it('publishes only the requested window plus overscan', async () => {
    const { board } = make();
    board.setWindow({ lane: 'all', stateId: 'todo', start: 10, end: 20 });
    const keys = Object.keys(await firstValueFrom(board.slots));
    expect(keys).toContain(slotKey('all', 'todo', 10 - OVERSCAN));
    expect(keys).not.toContain(slotKey('all', 'todo', 10 - OVERSCAN - 1));
    expect(keys.every(key => key.startsWith('all|todo:'))).toBe(true);
  });

  it('moves a card to another column, as a store transaction', () => {
    const { store, board } = make();
    const id = board.orderOf('todo')[0]!;
    board.move({ id, lane: 'all', stateId: 'done', index: 2 });
    expect(board.orderOf('todo')).not.toContain(id);
    expect(board.orderOf('done')[2]).toBe(id);
    expect(store.get(id)!.stateId).toBe('done');
    expect(store.undoLabel).toMatch(/^Moved .+ to Done$/);
  });

  it('counts a same-column index before removal', () => {
    const { board } = make();
    const [a, b, c] = board.orderOf('todo');
    // Dropping A on C's slot means "before C", which is index 1 once A has left.
    board.move({ id: a!, lane: 'all', stateId: 'todo', index: 2 });
    expect(board.orderOf('todo').slice(0, 3)).toEqual([b, a, c]);
  });

  it('undoes moves in either direction', () => {
    const { board } = make();
    const before = { todo: [...board.orderOf('todo')], done: [...board.orderOf('done')] };
    const [a, , , d] = board.orderOf('todo');
    board.move({ id: a!, lane: 'all', stateId: 'todo', index: 3 });
    board.move({ id: d!, lane: 'all', stateId: 'todo', index: 0 });
    board.move({ id: a!, lane: 'all', stateId: 'done', index: 0 });
    board.undo();
    board.undo();
    board.undo();
    expect(board.orderOf('todo')).toEqual(before.todo);
    expect(board.orderOf('done')).toEqual(before.done);
  });

  it('bumps the revision of only the columns a move touched', () => {
    const { board } = make();
    const before = board.revisions.value;
    board.move({ id: board.orderOf('todo')[0]!, lane: 'all', stateId: 'done', index: 0 });
    const after = board.revisions.value;
    const changed = Object.keys(after).filter(id => after[id] !== before[id]);
    expect(changed.sort()).toEqual([cellKey('all', 'done'), cellKey('all', 'todo')]);
  });

  it('renumbers a column whose ranks have run out of room, in the same undo', () => {
    const { store, board } = make();
    const [a, b] = board.orderOf('todo');
    store.update([b!], { rank: store.get(a!)!.rank + 1e-9 }, 'Squeeze');
    const mover = board.orderOf('backlog')[0]!;
    board.move({ id: mover, lane: 'all', stateId: 'todo', index: 1 });
    expect(board.orderOf('todo').slice(0, 3)).toEqual([a, mover, b]);
    board.undo();
    expect(board.orderOf('todo').slice(0, 2)).toEqual([a, b]);
    expect(store.get(mover)!.stateId).toBe('backlog');
  });

  it("shows one team's issues, and every team's again", async () => {
    const { store, board } = make();
    board.setTeam('ops');
    const columns = await firstValueFrom(board.columns);
    const ops = [...store.issues()].filter(issue => issue.teamId === 'ops').length;
    expect(columns.reduce((sum, column) => sum + column.count, 0)).toBe(ops);
    expect(board.orderOf('todo').every(id => store.get(id)!.teamId === 'ops')).toBe(true);
    board.setTeam(null);
    expect((await firstValueFrom(board.columns)).reduce((sum, column) => sum + column.count, 0)).toBe(200);
  });

  it('splits into swimlanes, and a drop into a lane reassigns', async () => {
    const { store, board } = make();
    board.setLanes('assignee');
    const lanes = await firstValueFrom(board.lanes);
    expect(lanes.at(-1)!.key).toBe('none');
    expect(lanes.reduce((sum, lane) => sum + lane.total, 0)).toBe(200);
    const from = lanes[0]!;
    const to = lanes[1]!;
    const id = board.orderOf('todo', from.key)[0] ?? board.orderOf('backlog', from.key)[0]!;
    board.move({ id, lane: to.key, stateId: 'done', index: 0 });
    expect(store.get(id)).toMatchObject({ assigneeId: to.key, stateId: 'done' });
    expect(board.orderOf('done', to.key)[0]).toBe(id);
    board.undo();
    expect(store.get(id)!.assigneeId).toBe(from.key);
  });

  it('puts a card dropped in the no-assignee lane out of anyone\'s hands', () => {
    const { store, board } = make();
    board.setLanes('assignee');
    const id = [...store.issues()].find(issue => issue.assigneeId !== null)!.id;
    board.move({ id, lane: 'none', stateId: 'todo', index: 0 });
    expect(store.get(id)!.assigneeId).toBeNull();
  });

  it('follows an edit made somewhere else', async () => {
    const { store, board } = make();
    board.setWindow({ lane: 'all', stateId: 'todo', start: 0, end: 5 });
    const id = board.orderOf('todo')[0]!;
    store.update([id], { title: 'Edited from the list' }, 'Rename');
    expect((await firstValueFrom(board.slots))[slotKey('all', 'todo', 0)]!.title).toBe('Edited from the list');
  });

  it('builds 50,000 issues and a window quickly enough for a worker start', async () => {
    const started = performance.now();
    const { board } = make(50_000);
    board.setWindow({ lane: 'all', stateId: 'backlog', start: 0, end: 30 });
    await firstValueFrom(board.slots);
    expect(performance.now() - started).toBeLessThan(budget(2000));
  });
});
