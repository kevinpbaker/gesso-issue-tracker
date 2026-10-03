import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { percent, shortcut, shortcuts } from 'gesso-core';
import { createComponent, OverlayService, ServiceRegistry, type ComponentContext, type Inputs } from 'gesso-framework';
import { renderTest, serveForTest, type Rendered, type ServedForTest } from 'gesso-testing';

import { ComposeService } from '../compose/ComposeService';
import { EMPTY_DRAFT } from '../compose/ComposeContract';
import { IssueDetailService } from '../detail/IssueDetailService';
import { IssueList } from '../issues/IssueList';
import { IssueQueryService } from '../issues/IssueQueryService';
import { Issues } from '../issues/IssuesContract';
import { issuesSource } from '../issues/issuesSource';
import { IssueStore } from '../model/IssueStore';
import { DEFAULT_QUERY } from '../model/query';
import { seedWorkspace } from '../model/seed';
import { CommandsService } from '../palette/CommandsService';
import { Views } from '../views/ViewsContract';
import { ShortcutsService } from './ShortcutsService';
import { UndoToast } from './UndoToast';
import { WorkspaceMeta } from './WorkspaceContract';
import { workspaceSource } from './workspaceSource';

/**
 * The undo toast: after every change, wherever it was made, a polite
 * notice of what it did, with Undo; after an undo, what was undone,
 * with Redo; and in the same place, what a command said. Changes are
 * made the way a person makes them where that's the point (the list's
 * keys, Mod+Z, the toast's button), and straight on the app worker's
 * side where only the notice is.
 */

/** The shell's part: Mod+Z and Mod+Shift+Z, the toast, and a list to change things from. */
function Shell(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const { registry } = ctx.inject(ShortcutsService);
  const issues = ctx.channel(Issues);
  return (
    <column
      width={percent(100)}
      height={percent(100)}
      modifiers={[
        shortcuts({ registry }),
        shortcut({ registry, keys: 'Mod+Z', label: 'Undo', scoped: false, run: () => issues.send.undo() }),
        shortcut({ registry, keys: 'Mod+Shift+Z', label: 'Redo', scoped: false, run: () => issues.send.redo() })
      ]}>
      <IssueList query={of({ ...DEFAULT_QUERY, group: 'none' as const })} />
      <UndoToast />
    </column>
  );
}

interface Mounted {
  ui: Rendered;
  served: ServedForTest;
  store: IssueStore;
  service: IssueQueryService;
}

let h: Mounted;
afterEach(() => {
  h?.ui.unmount();
  h?.served.dispose();
});

const disk = {
  read: async () => ({ outcome: 'ok' as const, value: null }),
  write: async () => 'ok' as const,
  remove: async () => 'ok' as const
};

async function mount(): Promise<void> {
  const store = new IssueStore(seedWorkspace({ issues: 300 }));
  const service = new IssueQueryService(store);
  const served = serveForTest([
    { token: Issues, source: issuesSource(service, store, () => store.reset()) },
    { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') },
    { token: Views, source: { view: { views: of([]), saved: of(null) }, commands: { save: () => {}, rename: () => {}, remove: () => {} } } }
  ]);
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  services.register(CommandsService);
  const ui = renderTest(createComponent(Shell), { channels: served.registry, width: 1200, height: 700, services });
  h = { ui, served, store, service };
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await h.ui.settle();
    await h.served.settle();
  }
}

async function press(key: string, modifiers: { shift?: boolean; ctrl?: boolean } = {}): Promise<void> {
  h.ui.fireEvent.press(key, modifiers);
  await settle();
}

/** What the toast says, or null when there's none up. */
const notice = (): string | null => {
  const status = h.ui.queryByRole('status');
  return status === null ? null : (h.ui.getSemantics(status).label ?? null);
};
const toasts = () => h.ui.runtime.services.get(OverlayService).entries.value.filter(entry => entry.id.startsWith('toast'));

describe('the undo toast', () => {
  it('says what a change from the list did, and its Undo takes it back as one step', async () => {
    await mount();
    await press('x');
    await press('J', { shift: true });
    await press('J', { shift: true });
    const ids = h.service.selectedIds();
    const before = ids.map(id => h.store.get(id)!.stateId);
    await press('s');
    h.ui.fireEvent.type('done');
    await settle();
    await press('Enter');
    expect(notice()).toBe('Moved 3 issues to Done');
    // Announced politely: a status, not an alert, and focus stays on the list.
    expect(h.ui.queryByRole('alert')).toBeNull();
    expect(h.ui.runtime.input.focus.focusedNode).toBe(h.ui.getByRole('listbox', { name: 'Issues' }));

    h.ui.fireEvent.click(h.ui.getByRole('button', { name: 'Undo' }));
    await settle();
    expect(ids.map(id => h.store.get(id)!.stateId)).toEqual(before);
    expect(notice()).toBe('Undone: Moved 3 issues to Done');

    h.ui.fireEvent.click(h.ui.getByRole('button', { name: 'Redo' }));
    await settle();
    expect(ids.every(id => h.store.get(id)!.stateId === 'done')).toBe(true);
    expect(notice()).toBe('Moved 3 issues to Done');
    expect(toasts()).toHaveLength(1);
  });

  it('follows Mod+Z and Mod+Shift+Z the same way', async () => {
    await mount();
    await press('i');
    const label = h.store.undoLabel!;
    expect(notice()).toBe(label);
    await press('z', { ctrl: true });
    expect(notice()).toBe(`Undone: ${label}`);
    await press('Z', { ctrl: true, shift: true });
    expect(notice()).toBe(label);
  });

  it('raises a new toast for each change, one at a time', async () => {
    await mount();
    await press('i');
    await press('j');
    await press('i');
    // One up, saying the second, so a screen reader hears the second.
    expect(toasts()).toHaveLength(1);
    expect(notice()).toBe(h.store.undoLabel);
  });

  it('says what the issue page, the palette and the new issue dialog did', async () => {
    await mount();
    const issue = [...h.store.issues()][0]!;
    const detail = new IssueDetailService(h.store, 'u0');
    detail.open(issue.key);
    detail.update({ priority: 4 }, `Set ${issue.key} to Low priority`);
    await settle();
    expect(notice()).toBe(`Set ${issue.key} to Low priority`);

    const compose = new ComposeService(h.store, disk, 'u0');
    compose.file({ ...EMPTY_DRAFT, title: 'Flaky test', teamId: 'web' });
    await settle();
    expect(notice()).toMatch(/^Filed WEB-\d+: Flaky test$/);
  });

  it('stays quiet while a description is typed, which saves at every pause', async () => {
    await mount();
    const issue = [...h.store.issues()][0]!;
    const detail = new IssueDetailService(h.store, 'u0');
    detail.open(issue.key);
    detail.update({ description: 'Steps to reproduce' }, 'Edited the description');
    await settle();
    expect(notice()).toBeNull();
  });

  it('goes away when the workspace is reset, leaving nothing to undo', async () => {
    await mount();
    await press('i');
    expect(notice()).not.toBeNull();
    h.store.reset();
    await settle();
    expect(notice()).toBeNull();
  });

  it("shows what a command said in the same place, in place of a change's notice", async () => {
    await mount();
    await press('i');
    const label = h.store.undoLabel!;
    h.ui.runtime.services.get(CommandsService).say("Copied WEB-1's link");
    await settle();
    // One notice, so the two can't cover each other on a narrow window.
    expect(toasts()).toHaveLength(1);
    expect(notice()).toBe("Copied WEB-1's link");
    expect(h.ui.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect([toasts()[0]!.bottom, toasts()[0]!.left]).toEqual([72, 72]);
    // The change is still Mod+Z away, and its undo is the next notice.
    await press('z', { ctrl: true });
    expect(notice()).toBe(`Undone: ${label}`);
  });

  it('sits above the selection toolbar, in the corner the tour leaves free', async () => {
    await mount();
    await press('i');
    const [entry] = toasts();
    expect([entry!.bottom, entry!.left, entry!.right]).toEqual([72, 72, undefined]);
  });
});
