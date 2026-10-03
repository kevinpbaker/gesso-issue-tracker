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

  it('finds issues by key, then by title, never the open one', async () => {
    const { store, detail } = make();
    detail.open('WEB-1');
    detail.find('web-1');
    const keys = detail.found.value.map(ref => ref.key);
    expect(keys[0]).toBe('WEB-10');
    expect(keys).not.toContain('WEB-1');
    expect(keys.every(key => key.startsWith('WEB-1'))).toBe(true);
    const title = [...store.issues()].find(issue => issue.key !== 'WEB-1')!.title;
    detail.find(title.split(' ')[1]!);
    expect(detail.found.value.length).toBeGreaterThan(0);
    detail.find('  ');
    expect(detail.found.value).toEqual([]);
  });

  it('makes and unmakes sub-issues, one level deep', async () => {
    const { store, detail } = make();
    const [a, b, c] = [...store.issues()].filter(issue => issue.parentId === null && store.childrenOf(issue.id).length === 0).slice(0, 3);
    detail.open(a!.key);
    detail.addChild(b!.key);
    let read = (await firstValueFrom(detail.detail))!;
    expect(read.children.map(ref => ref.key)).toEqual([b!.key]);
    // A sub-issue can't take sub-issues of its own.
    detail.open(b!.key);
    detail.addChild(c!.key);
    expect(store.get(c!.id)!.parentId).toBeNull();
    read = (await firstValueFrom(detail.detail))!;
    expect(read.parent?.key).toBe(a!.key);
    expect(read.activity.at(-1)!.text).toBe(`Ada Okafor made this a sub-issue of ${a!.key}`);
    detail.setParent(null);
    expect(store.get(b!.id)!.parentId).toBeNull();
    detail.open(a!.key);
    detail.addChild(b!.key);
    detail.removeChild(b!.key);
    expect(store.childrenOf(a!.id)).toEqual([]);
  });

  it('links issues and reads each link from its own end', async () => {
    const { store, detail } = make();
    detail.open('WEB-2');
    const other = [...store.issues()].find(issue => issue.key === 'API-3')!;
    detail.link('API-3', 'blocked-by');
    let read = (await firstValueFrom(detail.detail))!;
    const link = read.links.find(row => row.other.key === 'API-3')!;
    expect(link.phrase).toBe('Blocked by');
    expect(read.activity.at(-1)!.text).toBe('Ada Okafor marked this as blocked by API-3');
    detail.open(other.key);
    read = (await firstValueFrom(detail.detail))!;
    expect(read.links.find(row => row.other.key === 'WEB-2')!.phrase).toBe('Blocks');
    detail.unlink(link.id);
    read = (await firstValueFrom(detail.detail))!;
    expect(read.links.some(row => row.other.key === 'WEB-2')).toBe(false);
  });

  it('describes an estimate and a due date in words', async () => {
    const { detail } = make();
    detail.open('WEB-3');
    detail.update({ estimate: 3 }, 'Estimate');
    detail.update({ dueDate: '2026-11-02' }, 'Due');
    detail.update({ dueDate: null }, 'Undue');
    const texts = (await firstValueFrom(detail.detail))!.activity.map(row => row.text).slice(-3);
    expect(texts).toEqual(['Ada Okafor estimated this at 3 points', 'Ada Okafor set the due date to Nov 2, 2026', 'Ada Okafor removed the due date']);
  });
});
