import { afterEach, describe, expect, it } from 'vitest';

import { editorFor, percent, shortcut, shortcuts, type UiNode } from 'gesso-core';
import { createComponent, OverlayService, ServiceRegistry, type ComponentContext, type Inputs } from 'gesso-framework';
import { renderTest, serveForTest, type Rendered, type ServedForTest } from 'gesso-testing';

import { ShortcutsService } from '../app/ShortcutsService';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import { workspaceSource } from '../app/workspaceSource';
import { IssueStore } from '../model/IssueStore';
import type { TextStore } from '../model/persistence';
import { seedWorkspace } from '../model/seed';
import { Compose } from './ComposeContract';
import { ComposeService } from './ComposeService';
import { NewIssueDialog } from './NewIssueDialog';
import { NewIssueService } from './NewIssueService';

/**
 * Phase 7's exit criterion: ten issues in a row with "Create more" and
 * no mouse, and a validation error that is announced. Then the draft:
 * it survives closing the dialog and a reload.
 */

class MemoryDisk implements TextStore {
  readonly saved = new Map<string, string>();
  async read(key: string) {
    return { outcome: 'ok', value: this.saved.get(key) ?? null };
  }
  async write(key: string, value: string) {
    this.saved.set(key, value);
    return 'ok';
  }
  async remove(key: string) {
    this.saved.delete(key);
    return 'ok';
  }
}

/** The shell's part: the `c` shortcut and the dialog. */
function Shell(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const { registry } = ctx.inject(ShortcutsService);
  const newIssue = ctx.inject(NewIssueService);
  return (
    <column
      width={percent(100)}
      height={percent(100)}
      focusable
      label="Page"
      modifiers={[shortcuts({ registry }), shortcut({ registry, keys: 'c', label: 'New issue', scoped: false, run: () => (newIssue.open.value = true) })]}>
      <NewIssueDialog open={newIssue.open} onClose={() => (newIssue.open.value = false)} />
    </column>
  );
}

interface Mounted {
  ui: Rendered;
  served: ServedForTest;
  store: IssueStore;
  compose: ComposeService;
}

let h: Mounted;
afterEach(() => {
  h?.ui.unmount();
  h?.served.dispose();
});

async function mount(disk = new MemoryDisk(), store = new IssueStore(seedWorkspace({ issues: 300 }), 1)): Promise<void> {
  const compose = new ComposeService(store, disk);
  await compose.restore();
  const served = serveForTest([
    { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') },
    {
      token: Compose,
      source: {
        view: { draft: compose.draft, filed: compose.filed },
        commands: { save: d => compose.save(d), file: d => compose.file(d), discard: () => compose.discard() }
      }
    }
  ]);
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  services.register(NewIssueService);
  const ui = renderTest(createComponent(Shell), { channels: served.registry, width: 1000, height: 900, services });
  h = { ui, served, store, compose };
  await settle();
  ui.fireEvent.focus(ui.getByLabel('Page'));
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

async function type(text: string): Promise<void> {
  h.ui.fireEvent.type(text);
  await settle();
}

const focused = (): UiNode | null => h.ui.runtime.input.focus.focusedNode;
const isOpen = (): boolean => h.ui.runtime.services.get(OverlayService).entries.value.some(entry => entry.id.startsWith('dialog'));
/** Tabs forward until the node with that role and name has focus. */
async function tabTo(role: 'switch' | 'combobox' | 'textbox', name: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const node = focused();
    if (node !== null && h.ui.querySemantics(node)?.role === role && h.ui.querySemantics(node)?.label === name) return;
    await press('Tab');
  }
  throw new Error(`Tab never reached ${role} "${name}"`);
}

describe('the New issue dialog', () => {
  it('files ten issues in a row with Create more, from the keyboard alone', async () => {
    await mount();
    await press('c');
    expect(isOpen()).toBe(true);
    // The caret starts in the title.
    expect(focused()).toBe(h.ui.getByRole('textbox', { name: 'Title' }));

    // Mod+Enter on an empty title: refused, said aloud, caret on the title.
    await press('Enter', { ctrl: true });
    const live = h.ui.getAllByText(/Can't file yet/)[0]!;
    expect(h.ui.getSemantics(live)).toMatchObject({ live: 'assertive', label: "Can't file yet. Title: Give the issue a title." });
    expect(h.ui.getSemantics(h.ui.getByRole('textbox', { name: 'Title' })).description).toBe('Give the issue a title');
    expect(focused()).toBe(h.ui.getByRole('textbox', { name: 'Title' }));

    // The team and an assignee, chosen once and kept for every issue after.
    await tabTo('combobox', 'Team');
    await press('Enter');
    await press('ArrowDown');
    await press('Enter');
    await tabTo('combobox', 'Assignee');
    await type('kemi');
    await press('Enter');
    await tabTo('switch', 'Create more');
    await press(' ');

    const before = h.store.size;
    for (let n = 1; n <= 10; n++) {
      await tabTo('textbox', 'Title');
      await type(`Flaky test number ${n}`);
      await press('Enter', { ctrl: true });
      expect(isOpen()).toBe(true);
      expect(h.ui.getAllByText(new RegExp(`^Filed API-\\d+: Flaky test number ${n}$`)).length).toBe(1);
    }
    expect(h.store.size).toBe(before + 10);
    const filed = [...h.store.issues()].filter(issue => issue.title.startsWith('Flaky test number'));
    expect(filed).toHaveLength(10);
    expect(new Set(filed.map(issue => issue.key)).size).toBe(10);
    expect(filed.every(issue => issue.teamId === 'api' && issue.assigneeId === 'u10')).toBe(true);
    // The next form starts empty, with the caret in the title.
    expect(editorFor(h.ui.getByRole('textbox', { name: 'Title' })).text).toBe('');
    expect(focused()).toBe(h.ui.getByRole('textbox', { name: 'Title' }));
  });

  it('keeps a half-written issue through closing the dialog and a reload', async () => {
    const disk = new MemoryDisk();
    const store = new IssueStore(seedWorkspace({ issues: 300 }), 1);
    await mount(disk, store);
    await press('c');
    await type('Half a thought');
    await press('Escape');
    expect(isOpen()).toBe(false);
    await press('c');
    expect(editorFor(h.ui.getByRole('textbox', { name: 'Title' })).text).toBe('Half a thought');
    await h.compose.flush();

    h.ui.unmount();
    h.served.dispose();
    await mount(disk, store);
    await press('c');
    expect(editorFor(h.ui.getByRole('textbox', { name: 'Title' })).text).toBe('Half a thought');
  });
});
