import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { IssueStore } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';
import { IssueDetailService } from './IssueDetailService';

const make = () => {
  const store = new IssueStore(seedWorkspace({ issues: 300 }));
  return { store, detail: new IssueDetailService(store, 'u0', () => 42) };
};

describe('the issue detail service', () => {
  it('opens an issue by key, in any case', async () => {
    const { detail } = make();
    detail.open('web-1');
    const read = await firstValueFrom(detail.detail);
    expect(read!.issue!.key).toBe('WEB-1');
    expect(read!.asked).toBe('web-1');
    expect(read!.teamName).toBe('Web');
  });

  it('answers an unknown key with no issue rather than nothing', async () => {
    const { detail } = make();
    detail.open('NOPE-1');
    expect((await firstValueFrom(detail.detail))!.issue).toBeNull();
  });

  it('describes changes in the activity feed in words', async () => {
    const { store, detail } = make();
    // An issue that starts assigned and not done, so both edits change something.
    const issue = [...store.issues()].find(i => i.stateId !== 'done' && i.assigneeId !== null)!;
    detail.open(issue.key);
    detail.update({ stateId: 'done' }, 'Done');
    detail.update({ assigneeId: null }, 'Unassign');
    const activity = (await firstValueFrom(detail.detail))!.activity.map(row => row.text);
    expect(activity).toEqual([expect.stringMatching(/^Ada Okafor moved this from .+ to Done$/), 'Ada Okafor unassigned this']);
  });

  it('adds a comment as me, and ignores an empty one', async () => {
    const { detail } = make();
    detail.open('WEB-2');
    const before = (await firstValueFrom(detail.detail))!.comments.length;
    detail.comment('   ');
    detail.comment('Looks good');
    const comments = (await firstValueFrom(detail.detail))!.comments;
    expect(comments).toHaveLength(before + 1);
    expect(comments.at(-1)).toMatchObject({ author: 'Ada Okafor', body: 'Looks good' });
  });
});
