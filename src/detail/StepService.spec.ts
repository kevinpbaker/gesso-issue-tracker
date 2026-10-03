import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { createBoardStore } from '../board/BoardStore';
import { IssueStore } from '../model/IssueStore';
import { DEFAULT_QUERY, runQuery, type IssueQuery } from '../model/query';
import { seedWorkspace } from '../model/seed';
import { StepService } from './StepService';
import type { StepList } from './StepsContract';

const make = () => {
  const store = new IssueStore(seedWorkspace({ issues: 400 }));
  const board = createBoardStore(store);
  return { store, board, steps: new StepService(store, board) };
};

const urgent: IssueQuery = { ...DEFAULT_QUERY, filter: { priorities: [1] }, group: 'none' };
const web: IssueQuery = { ...DEFAULT_QUERY, filter: { teamIds: ['web'] } };
const list = (query: IssueQuery): StepList => ({ kind: 'list', query });

describe('the step service', () => {
  it('says where an issue is in its list, and which issues are either side', async () => {
    const { store, steps } = make();
    const keys = runQuery(store.workspace, store.issues(), urgent).ids.map(id => store.get(id)!.key);
    steps.follow(keys[3]!, [list(urgent)]);
    expect(await firstValueFrom(steps.at)).toEqual({
      key: keys[3],
      list: 0,
      index: 3,
      within: true,
      total: keys.length,
      previous: keys[2],
      next: keys[4],
      spot: null
    });
    steps.follow(keys[0]!, [list(urgent)]);
    expect((await firstValueFrom(steps.at))!.previous).toBeNull();
  });

  it("counts it in the next list when the first doesn't have it", async () => {
    const { store, steps } = make();
    const issue = [...store.issues()].find(i => i.teamId === 'web' && i.priority !== 1)!;
    steps.follow(issue.key, [list(urgent), list(web)]);
    const at = (await firstValueFrom(steps.at))!;
    expect(at.list).toBe(1);
    expect(at.within).toBe(true);
    expect(at.total).toBe([...store.issues()].filter(i => i.teamId === 'web').length);
  });

  it('keeps its list when an edit takes the issue out, and the neighbours it had', async () => {
    const { store, steps } = make();
    const ids = runQuery(store.workspace, store.issues(), urgent).ids;
    const key = (id: string) => store.get(id)!.key;
    steps.follow(key(ids[3]!), [list(urgent), list(web)]);
    store.update([ids[3]!], { priority: 4 }, 'Lowered');
    const at = (await firstValueFrom(steps.at))!;
    expect(at).toMatchObject({ list: 0, index: 3, within: false, total: ids.length - 1, previous: key(ids[2]!), next: key(ids[4]!) });
  });

  it('follows a re-sort', async () => {
    const { store, steps } = make();
    const ids = runQuery(store.workspace, store.issues(), web).ids;
    const last = store.get(ids[ids.length - 1]!)!;
    steps.follow(last.key, [list(web)]);
    expect((await firstValueFrom(steps.at))!.next).toBeNull();
    // Urgent and in the first state: the top of the list.
    store.update([last.id], { priority: 1, stateId: store.get(ids[0]!)!.stateId }, 'Raised');
    expect((await firstValueFrom(steps.at))!.index).toBeLessThan(ids.length - 1);
  });

  it('reads the board column by column, and says where each card sits', async () => {
    const { store, board, steps } = make();
    board.setTeam('web');
    const [first, second] = store.workspace.states.map(state => board.orderOf(state.id)).filter(ids => ids.length > 0);
    const lastOfFirst = first![first!.length - 1]!;
    steps.follow(store.get(lastOfFirst)!.key, [{ kind: 'board' }]);
    const at = (await firstValueFrom(steps.at))!;
    expect(at.next).toBe(store.get(second![0]!)!.key);
    expect(at.spot).toEqual({ lane: 'all', stateId: store.get(lastOfFirst)!.stateId, index: first!.length - 1 });
  });

  it('says nothing once stopped', async () => {
    const { store, steps } = make();
    steps.follow([...store.issues()][0]!.key, [list(web)]);
    steps.stop();
    expect(await firstValueFrom(steps.at)).toBeNull();
  });
});
