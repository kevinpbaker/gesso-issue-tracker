import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { percent, shortcut, shortcuts } from 'gesso-core';
import { createComponent, route, RouterService, ServiceRegistry, type ComponentContext, type Inputs } from 'gesso-framework';
import { renderTest, serveForTest, type Rendered, type ServedForTest } from 'gesso-testing';

import { ShortcutsService } from '../app/ShortcutsService';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import { workspaceSource } from '../app/workspaceSource';
import { IssueList } from '../issues/IssueList';
import { IssueQueryService } from '../issues/IssueQueryService';
import { Issues } from '../issues/IssuesContract';
import { issuesSource } from '../issues/issuesSource';
import { IssueStore } from '../model/IssueStore';
import { DEFAULT_QUERY } from '../model/query';
import { seedWorkspace } from '../model/seed';
import { Views } from '../views/ViewsContract';
import { ViewsStore } from '../views/ViewsStore';
import { CommandPalette } from './CommandPalette';
import { CommandsService } from './CommandsService';
import { Palette } from './PaletteContract';
import { PaletteService } from './PaletteService';

/**
 * Phase 8's exit criterion, the palette's half: every action can be
 * found in it. Whatever shortcut is live where focus is shows up in its
 * catalog, the selection's commands are there while issues are
 * selected, a fuzzy query finds and runs one, and a key opens an issue.
 */

function Harness(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const { registry } = ctx.inject(ShortcutsService);
  const palette = ctx.inject(CommandsService);
  return (
    <column
      width={percent(100)}
      height={percent(100)}
      modifiers={[
        shortcuts({ registry }),
        shortcut({ registry, keys: 'Mod+K', label: 'Open the command palette', scoped: false, run: () => (palette.open.value = true) })
      ]}>
      <IssueList query={of({ ...DEFAULT_QUERY, group: 'none' as const })} />
      <CommandPalette />
    </column>
  );
}

interface Mounted {
  ui: Rendered;
  served: ServedForTest;
  store: IssueStore;
  service: IssueQueryService;
  palette: PaletteService;
}

let h: Mounted;
afterEach(() => {
  h?.ui.unmount();
  h?.served.dispose();
});

async function mount(): Promise<void> {
  const store = new IssueStore(seedWorkspace({ issues: 400 }));
  const service = new IssueQueryService(store);
  const palette = new PaletteService(store);
  const views = new ViewsStore({ read: async () => ({ outcome: 'ok', value: null }), write: async () => 'ok', remove: async () => 'ok' });
  const served = serveForTest([
    { token: Issues, source: issuesSource(service, store, () => store.reset()) },
    { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') },
    { token: Views, source: { view: { views: views.views, saved: views.saved }, commands: { save: () => {}, rename: () => {}, remove: () => {} } } },
    {
      token: Palette,
      source: { view: { results: palette.results }, commands: { setCatalog: e => palette.setCatalog(e), search: q => palette.search(q) } }
    }
  ]);
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  services.register(CommandsService);
  const ui = renderTest(createComponent(Harness), { channels: served.registry, width: 1000, height: 700, services });
  ui.runtime.services.get(RouterService).setRoutes({ routes: [route({ path: '/issue/:key', component: Harness })] });
  h = { ui, served, store, service, palette };
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

/** What the palette sent the app worker to match against. */
const catalog = (): string[] => h.palette.rank('').map(item => item.label);
const results = (): string[] => h.palette.results.value.items.map(item => item.label);

describe('the command palette', () => {
  it('lists every shortcut live where focus was, and nothing else hides one', async () => {
    await mount();
    const { registry } = h.ui.runtime.services.get(ShortcutsService);
    const live = registry.active(h.ui.runtime.input.focus.focusedNode).map(binding => binding.label);
    await press('k', { ctrl: true });
    expect(live.length).toBeGreaterThan(5);
    for (const label of live) {
      expect(catalog()).toContain(label);
    }
  });

  it('offers to change the selected issues, and does it, from a fuzzy query', async () => {
    await mount();
    await press('x');
    await press('J', { shift: true });
    const selected = h.service.selectedIds();
    expect(selected).toHaveLength(2);
    await press('k', { ctrl: true });
    expect(catalog()).toEqual(expect.arrayContaining(['Set status: Done', 'Assign to Grace Kim', 'Add label: Bug', 'Clear the selection']));
    await type('status done');
    expect(results()[0]).toBe('Set status: Done');
    await press('Enter');
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    expect(selected.every(id => h.store.get(id)!.stateId === 'done')).toBe(true);
  });

  it('opens an issue by its key', async () => {
    await mount();
    await press('k', { ctrl: true });
    await type('web-3');
    expect(h.palette.results.value.items[0]).toMatchObject({ kind: 'issue' });
    const key = h.palette.results.value.items[0]!.id;
    await press('Enter');
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    expect(h.ui.runtime.services.get(RouterService).url.value).toBe(`/issue/${key}`);
  });

  it('closes on Escape without doing anything', async () => {
    await mount();
    const before = h.store.version.value;
    await press('k', { ctrl: true });
    await type('done');
    await press('Escape');
    expect(h.ui.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    expect(h.store.version.value).toBe(before);
  });
});
