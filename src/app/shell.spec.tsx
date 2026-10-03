import { afterEach, describe, expect, it } from 'vitest';

import { createComponent, RouterService, ServiceRegistry, ShellService } from 'gesso-framework';
import { renderTest, serveForTest, type Rendered, type ServedForTest } from 'gesso-testing';

import { Board } from '../board/BoardContract';
import { boardSource } from '../board/boardSource';
import { createBoardStore } from '../board/BoardStore';
import { Compose } from '../compose/ComposeContract';
import { ComposeService } from '../compose/ComposeService';
import { NewIssueService } from '../compose/NewIssueService';
import { IssueDetailChannel } from '../detail/IssueDetailContract';
import { IssueDetailService } from '../detail/IssueDetailService';
import { detailSource } from '../detail/detailSource';
import { IssueQueryService } from '../issues/IssueQueryService';
import { Issues } from '../issues/IssuesContract';
import { issuesSource } from '../issues/issuesSource';
import { IssueStore } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';
import { CommandsService } from '../palette/CommandsService';
import { Palette } from '../palette/PaletteContract';
import { PaletteService } from '../palette/PaletteService';
import { Views } from '../views/ViewsContract';
import { ViewsStore } from '../views/ViewsStore';
import { Preferences } from './PreferencesContract';
import { PreferencesStore } from './PreferencesStore';
import { AppRoot, ROUTES, TeamIssues } from './routes';
import { ShortcutsService } from './ShortcutsService';
import { WorkspaceMeta } from './WorkspaceContract';
import { workspaceSource } from './workspaceSource';

/**
 * The whole shell, with every channel, as the two workers assemble it,
 * so what's checked is the page a person sees rather than a part of it.
 */

const disk = {
  read: async () => ({ outcome: 'ok' as const, value: null }),
  write: async () => 'ok' as const,
  remove: async () => 'ok' as const
};

let ui: Rendered;
let served: ServedForTest;
afterEach(() => {
  ui?.unmount();
  served?.dispose();
});

async function mount(url: string, width = 1280, height = 713): Promise<void> {
  const store = new IssueStore(seedWorkspace({ issues: 400 }));
  const preferences = new PreferencesStore(disk);
  const compose = new ComposeService(store, disk, 'u0');
  const views = new ViewsStore(disk);
  const palette = new PaletteService(store);
  served = serveForTest([
    { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') },
    {
      token: Preferences,
      source: {
        view: { theme: preferences.theme, sidebarSplit: preferences.sidebarSplit, sidebarOpen: preferences.sidebarOpen },
        commands: {
          setTheme: theme => preferences.setTheme(theme),
          setSidebarSplit: split => preferences.setSidebarSplit(split),
          setSidebarOpen: open => preferences.setSidebarOpen(open)
        }
      }
    },
    { token: Board, source: boardSource(createBoardStore(store)) },
    { token: Issues, source: issuesSource(new IssueQueryService(store), store, () => store.reset()) },
    { token: IssueDetailChannel, source: detailSource(new IssueDetailService(store, 'u0')) },
    {
      token: Compose,
      source: { view: { draft: compose.draft, filed: compose.filed }, commands: { save: d => compose.save(d), file: d => compose.file(d), discard: () => compose.discard() } }
    },
    { token: Views, source: { view: { views: views.views, saved: views.saved }, commands: { save: () => {}, rename: () => {}, remove: () => {} } } },
    { token: Palette, source: { view: { results: palette.results }, commands: { setCatalog: e => palette.setCatalog(e), search: q => palette.search(q) } } }
  ]);
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  services.register(NewIssueService);
  services.register(CommandsService);
  ui = renderTest(createComponent(AppRoot), { channels: served.registry, width, height, services });
  ui.runtime.services.get(RouterService).setRoutes({ routes: ROUTES, notFound: TeamIssues });
  ui.runtime.services.get(RouterService).navigate(url);
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await ui.settle();
    await served.settle();
  }
}

it('raises the contrast without moving anything', async () => {
  await mount('/team/web/list');
  const bar = () => ui.getLayout(ui.getByRole('banner', { name: 'Top bar' }));
  const list = () => ui.getLayout(ui.getByRole('listbox', { name: 'Issues' }));
  const before = { bar: bar(), list: list() };
  expect(before.bar.height).toBe(48);
  ui.runtime.services.get(ShellService).applyContrast('high');
  await settle();
  expect({ bar: bar(), list: list() }).toEqual(before);
  // A layout from the top gives the same, so the frames above aren't
  // agreeing with a stale one.
  ui.runtime.resize(1281, 713);
  await settle();
  ui.runtime.resize(1280, 713);
  await settle();
  expect({ bar: bar(), list: list() }).toEqual(before);
});

describe('at 320 CSS pixels, a window zoomed to 400%', () => {
  it('gives the page the whole width, with the sidebar a button away', async () => {
    await mount('/team/web/list', 320, 256);
    expect(ui.queryByRole('navigation', { name: 'Sidebar' })).toBeNull();
    expect(ui.getLayout(ui.getByRole('main', { name: 'Main' })).width).toBe(320);
    ui.fireEvent.click(ui.getByRole('button', { name: 'Menu' }));
    await settle();
    // The sidebar stands in for the page, and its Close button has the keyboard.
    expect(ui.queryByRole('main', { name: 'Main' })).toBeNull();
    expect(ui.runtime.input.focus.focusedNode).toBe(ui.getByRole('button', { name: 'Close the sidebar' }));
    ui.fireEvent.press('Escape');
    await settle();
    expect(ui.getByRole('main', { name: 'Main' })).toBeDefined();
    // Choosing a destination closes it too.
    ui.fireEvent.click(ui.getByRole('button', { name: 'Menu' }));
    await settle();
    ui.fireEvent.click(ui.getByRole('link', { name: 'My issues' }));
    await settle();
    expect(ui.runtime.services.get(RouterService).url.value).toBe('/my-issues');
    expect(ui.queryByRole('navigation', { name: 'Sidebar' })).toBeNull();
  });

  it("puts an issue's properties under it rather than beside it", async () => {
    await mount('/issue/WEB-12', 320, 256);
    const issue = ui.getLayout(ui.getByRole('textbox', { name: 'Title' }));
    const properties = ui.getLayout(ui.getByRole('region', { name: 'Properties' }));
    expect(properties.y).toBeGreaterThan(issue.y);
    expect(properties.x + properties.width).toBeLessThanOrEqual(320);
  });

  it('has no Menu button when the sidebar fits', async () => {
    await mount('/team/web/list');
    expect(ui.queryByRole('button', { name: 'Menu' })).toBeNull();
    expect(ui.getByRole('navigation', { name: 'Sidebar' })).toBeDefined();
    // The open page's link is the current one, which a screen reader says.
    expect(ui.getSemantics(ui.getByRole('link', { name: 'Web' })).states).toContain('current');
    expect(ui.getSemantics(ui.getByRole('link', { name: 'My issues' })).states ?? []).not.toContain('current');
  });
});
