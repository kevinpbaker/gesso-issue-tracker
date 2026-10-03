import { afterEach, describe, expect, it, vi } from 'vitest';

import { editorFor, percent, shortcuts, type UiNode } from 'gesso-core';
import { addDays, todayIso } from 'gesso-components';
import { createComponent, route, RouterService, ServiceRegistry, type ComponentContext, type Inputs } from 'gesso-framework';
import { renderTest, serveForTest, type Rendered, type ServedForTest } from 'gesso-testing';

import { ShortcutsService } from '../app/ShortcutsService';
import { CommandsService } from '../palette/CommandsService';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import { workspaceSource } from '../app/workspaceSource';
import { IssueStore } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';
import type { Issue } from '../model/types';
import { Recent } from '../recent/RecentContract';
import { RecentStore } from '../recent/RecentStore';
import { recentSource } from '../recent/recentSource';
import { IssueDetailChannel } from './IssueDetailContract';
import { IssueDetailService } from './IssueDetailService';
import { IssueScreen } from './IssueScreen';
import { detailSource } from './detailSource';

/**
 * The issue page from the keyboard: Phase 6. Every property is set
 * with the keys a person would press, a sub-issue and a link are found
 * by searching, the description and a comment are written in the
 * editor, and then the page is reloaded from what was saved. And the
 * issue's link and key copy, and opening it counts as a recent view.
 */

function Page(_inputs: Inputs<{}>, ctx: ComponentContext) {
  // The shell's one listener for the keys screens register.
  const { registry } = ctx.inject(ShortcutsService);
  return (
    <column width={percent(100)} height={percent(100)} modifiers={[shortcuts({ registry })]}>
      <IssueScreen />
    </column>
  );
}

interface Mounted {
  ui: Rendered;
  served: ServedForTest;
  store: IssueStore;
  recent: RecentStore;
  /** What was put on the clipboard. */
  copied: string[];
}

let h: Mounted;
/** What the shell answers a copy with: whether the browser took it. */
let clipboardWorks = true;
afterEach(() => {
  h?.ui.unmount();
  h?.served.dispose();
  clipboardWorks = true;
  vi.unstubAllGlobals();
});

const fresh = (): IssueStore => new IssueStore(seedWorkspace({ issues: 300 }), 1);

async function mount(store: IssueStore, key: string): Promise<void> {
  const recent = new RecentStore({ read: async () => ({ outcome: 'ok', value: null }), write: async () => 'ok', remove: async () => 'ok' });
  const served = serveForTest([
    { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') },
    { token: IssueDetailChannel, source: detailSource(new IssueDetailService(store, 'u0')) },
    { token: Recent, source: recentSource(recent) }
  ]);
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  services.register(CommandsService);
  const ui = renderTest(createComponent(Page), { channels: served.registry, width: 1400, height: 1400, services });
  // The shell's half of a copy, as the main thread does it.
  const copied: string[] = [];
  ui.runtime.onShellRequest(request => {
    if (request.type !== 'clipboard') return;
    if (clipboardWorks) copied.push(request.text);
    ui.runtime.settleClipboard(request.id, clipboardWorks);
  });
  const router = ui.runtime.services.get(RouterService);
  router.setRoutes({ routes: [route({ path: '/issue/:key', component: Page })] });
  router.navigate(`/issue/${key}`);
  h = { ui, served, store, recent, copied };
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await h.ui.settle();
    await h.served.settle();
  }
}

async function press(key: string, modifiers: { shift?: boolean; meta?: boolean; ctrl?: boolean } = {}): Promise<void> {
  h.ui.fireEvent.press(key, modifiers);
  await settle();
}

async function type(text: string): Promise<void> {
  h.ui.fireEvent.type(text);
  await settle();
}

async function focus(node: UiNode): Promise<void> {
  h.ui.fireEvent.focus(node);
  await settle();
}

const control = (role: 'combobox' | 'textbox', name: string): UiNode => h.ui.getByRole(role, { name });
const issue = (key: string): Issue => h.store.byKey(key)!;

describe('the issue page', () => {
  it('edits every part of an issue from the keyboard, and reloads it unchanged', async () => {
    const store = fresh();
    const [target, child, other] = [...store.issues()].filter(i => i.parentId === null && store.childrenOf(i.id).length === 0 && i.teamId === 'web');
    await mount(store, target!.key);

    // The title: select it all, type over it, Enter.
    await focus(control('textbox', 'Title'));
    const title = editorFor(control('textbox', 'Title'));
    title.select(0, title.text.length);
    await type('Search stops paging after page 3');
    await press('Enter');
    expect(issue(target!.key).title).toBe('Search stops paging after page 3');

    // Status and priority, through their lists.
    await focus(control('combobox', 'Status'));
    await press('Enter');
    await press('End');
    await press('Enter');
    expect(issue(target!.key).stateId).toBe('done');

    // The assignee, by typing part of a name.
    await focus(control('combobox', 'Assignee'));
    await type('gra');
    await press('Enter');
    expect(issue(target!.key).assigneeId).toBe(store.workspace.users.find(u => u.name === 'Grace Kim')!.id);

    // Labels, several, by typing each.
    await focus(control('combobox', 'Labels'));
    for (const label of ['perf', 'acc']) {
      await type(label);
      await press('Enter');
    }
    await press('Escape');
    const names = issue(target!.key).labelIds.map(id => store.workspace.labels.find(l => l.id === id)!.name);
    expect(names).toEqual(expect.arrayContaining(['Performance', 'Accessibility']));

    // An estimate, and a due date a week on from the one it has, or from today.
    await focus(control('combobox', 'Estimate'));
    await press('Enter');
    await press('Home');
    await press('ArrowDown');
    await press('ArrowDown');
    await press('Enter');
    expect(issue(target!.key).estimate).toBe(2);
    await focus(control('combobox', 'Due date'));
    await press('Enter');
    await press('ArrowDown');
    await press('Enter');
    expect(issue(target!.key).dueDate).toBe(addDays(target!.dueDate ?? todayIso(), 7));

    // A sub-issue and a link, found by searching for their keys.
    await focus(control('combobox', 'Add a sub-issue'));
    await type(child!.key);
    await press('Enter');
    expect(store.childrenOf(target!.id).map(i => i.key)).toEqual([child!.key]);
    await focus(control('combobox', 'Link type'));
    await press('Enter');
    await press('ArrowDown');
    await press('ArrowDown');
    await press('Enter');
    await focus(control('combobox', 'Link to an issue'));
    await type(other!.key);
    await press('Enter');
    const link = store.relationsOf(target!.id).find(r => r.fromId === other!.id || r.toId === other!.id)!;
    expect(link).toMatchObject({ kind: 'blocks', fromId: other!.id, toId: target!.id });

    // The description: a line at the end, saved when focus leaves.
    const blocks = h.ui.getAllByRole('textbox').filter(node => editorFor(node).text.startsWith(`${target!.title}.`));
    await focus(blocks[0]!);
    editorFor(blocks[0]!).select(editorFor(blocks[0]!).text.length);
    await type(' It happens on **every** browser.');
    await focus(control('combobox', 'Status'));
    expect(issue(target!.key).description).toContain('It happens on **every** browser.');

    // A comment, sent with Mod+Enter, mentioning someone.
    const comment = h.ui.getAllByRole('textbox', { name: 'Paragraph' }).find(node => node.properties.get('placeholder') === 'Leave a comment…')!;
    await focus(comment);
    await type('Fixed by @kim in API-3.');
    await press('Enter', { ctrl: true });
    expect(store.commentsOf(target!.id).at(-1)!.body).toBe('Fixed by @kim in API-3.');

    // Reloaded from what was saved: the same issue, the same page.
    const saved = JSON.parse(JSON.stringify(store.exportOverlay()));
    const before = issue(target!.key);
    h.ui.unmount();
    h.served.dispose();
    const reloaded = fresh();
    expect(reloaded.importOverlay(saved)).toBe(true);
    await mount(reloaded, target!.key);
    expect(issue(target!.key)).toEqual(before);
    expect(h.ui.getSemantics(control('combobox', 'Assignee')).valueText).toBe('Grace Kim');
    expect(h.ui.getSemantics(control('combobox', 'Estimate')).valueText).toBe('2 points');
    expect(h.ui.getAllByRole('textbox').some(node => editorFor(node).text.endsWith('It happens on **every** browser.'))).toBe(true);
    expect(h.ui.getByText(child!.title)).toBeDefined();
  });

  it('starts focus on the issue, and Tab goes on to its title', async () => {
    await mount(fresh(), 'WEB-12');
    const region = h.ui.runtime.input.focus.focusedNode!;
    expect(h.ui.getSemantics(region)).toMatchObject({ role: 'region' });
    expect(h.ui.getSemantics(region).label).toMatch(/^WEB-12 /);
    await press('Tab');
    expect(h.ui.runtime.input.focus.focusedNode).toBe(h.ui.getByRole('textbox', { name: 'Title' }));
  });

  it('keeps the caret somewhere when what held it goes', async () => {
    const store = fresh();
    const [target, child, other] = [...store.issues()].filter(i => i.parentId === null && store.childrenOf(i.id).length === 0 && i.teamId === 'web');
    await mount(store, target!.key);
    const focused = () => h.ui.runtime.input.focus.focusedNode;

    // A pick makes the field again, empty; the new one has the caret.
    await focus(control('combobox', 'Add a sub-issue'));
    await type(child!.key);
    await press('Enter');
    expect(focused()).toBe(control('combobox', 'Add a sub-issue'));
    await focus(control('combobox', 'Link to an issue'));
    await type(other!.key);
    await press('Enter');
    expect(focused()).toBe(control('combobox', 'Link to an issue'));

    // A row's remove button goes with its row; the section's field takes over.
    await focus(h.ui.getByRole('button', { name: `Remove ${child!.key} from sub-issues` }));
    await press('Enter');
    expect(store.childrenOf(target!.id)).toEqual([]);
    expect(focused()).toBe(control('combobox', 'Add a sub-issue'));
    await focus(h.ui.getByRole('button', { name: new RegExp(`^Remove the link: .* ${other!.key}$`) }));
    await press('Enter');
    expect(focused()).toBe(control('combobox', 'Link to an issue'));
  });

  it("copies the issue's link and key, from the page, the palette and Mod+Shift+C, and says so", async () => {
    vi.stubGlobal('location', { origin: 'https://tracker.test' });
    await mount(fresh(), 'WEB-12');
    const commands = h.ui.runtime.services.get(CommandsService);
    const link = 'https://tracker.test/issue/WEB-12';

    await press('C', { ctrl: true, shift: true });
    expect(h.copied).toEqual([link]);
    expect(commands.notice.value?.text).toBe("Copied WEB-12's link");

    h.ui.fireEvent.click(h.ui.getByRole('button', { name: 'Copy key' }));
    await settle();
    expect(h.copied).toEqual([link, 'WEB-12']);
    expect(commands.notice.value?.text).toBe('Copied WEB-12');

    // The palette offers both, under the issue's key.
    const offered = commands.commands().filter(command => command.group === 'WEB-12' && command.label.startsWith('Copy'));
    expect(offered.map(command => command.label)).toEqual(['Copy link', 'Copy key']);
    offered[0]!.run();
    h.ui.fireEvent.click(h.ui.getByRole('button', { name: 'Copy link' }));
    await settle();
    expect(h.copied).toEqual([link, 'WEB-12', link, link]);
  });

  it("doesn't say it copied when the browser refused", async () => {
    clipboardWorks = false;
    await mount(fresh(), 'WEB-12');
    await press('C', { ctrl: true, shift: true });
    expect(h.copied).toEqual([]);
    expect(h.ui.runtime.services.get(CommandsService).notice.value?.text).toBe("Couldn't copy the link");
  });

  it('counts each issue opened as a recent view, newest first', async () => {
    await mount(fresh(), 'WEB-12');
    expect(h.recent.keys.value).toEqual(['WEB-12']);
    h.ui.runtime.services.get(RouterService).navigate('/issue/WEB-13');
    await settle();
    // Typed in lower case, it's still the one issue.
    h.ui.runtime.services.get(RouterService).navigate('/issue/web-12');
    await settle();
    expect(h.recent.keys.value).toEqual(['WEB-12', 'WEB-13']);
  });

  it('says so when no issue has the key', async () => {
    await mount(fresh(), 'NOPE-1');
    expect(h.ui.getByText('No issue has that key.')).toBeDefined();
    expect(h.recent.keys.value).toEqual([]);
  });
});
