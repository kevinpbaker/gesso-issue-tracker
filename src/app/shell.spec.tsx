import { afterEach, describe, expect, it } from 'vitest';

import { darkTheme, editorFor, lightTheme, UiNodeType, type UiNode } from 'gesso-core';
import { createComponent, FocusService, RouterService, ServiceRegistry, ShellService } from 'gesso-framework';
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
import { StepService } from '../detail/StepService';
import { Steps } from '../detail/StepsContract';
import { stepsSource } from '../detail/stepsSource';
import { IssueQueryService } from '../issues/IssueQueryService';
import { Issues } from '../issues/IssuesContract';
import { issuesSource } from '../issues/issuesSource';
import { IssueStore } from '../model/IssueStore';
import { runQuery } from '../model/query';
import { seedWorkspace } from '../model/seed';
import { teamQuery } from '../issues/listScreens';
import { CommandsService } from '../palette/CommandsService';
import { Palette } from '../palette/PaletteContract';
import { PaletteService } from '../palette/PaletteService';
import { paletteSource } from '../palette/paletteSource';
import { Recent } from '../recent/RecentContract';
import { RecentStore } from '../recent/RecentStore';
import { recentSource } from '../recent/recentSource';
import { References } from '../references/ReferencesContract';
import { ReferenceService } from '../references/ReferenceService';
import { referencesSource } from '../references/referencesSource';
import { Views } from '../views/ViewsContract';
import { ViewsStore } from '../views/ViewsStore';
import { Preferences } from './PreferencesContract';
import { PreferencesStore } from './PreferencesStore';
import { preferencesSource } from './preferencesSource';
import { AppRoot, ROUTES, TeamIssues } from './routes';
import { ShortcutsService } from './ShortcutsService';
import { ListPlaces } from '../issues/ListPlaces';
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
let store: IssueStore;
afterEach(() => {
  ui?.unmount();
  served?.dispose();
});

async function mount(url: string, width = 1280, height = 713): Promise<void> {
  store = new IssueStore(seedWorkspace({ issues: 400 }));
  const preferences = new PreferencesStore(disk);
  // As the app worker does at start: nothing saved, so a first visit.
  void preferences.restore();
  const compose = new ComposeService(store, disk, 'u0');
  const views = new ViewsStore(disk);
  const recent = new RecentStore(disk);
  const palette = new PaletteService(store, () => recent.keys.value);
  const board = createBoardStore(store);
  served = serveForTest([
    { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') },
    { token: Preferences, source: preferencesSource(preferences) },
    { token: Board, source: boardSource(board) },
    { token: Issues, source: issuesSource(new IssueQueryService(store), store, () => store.reset()) },
    { token: IssueDetailChannel, source: detailSource(new IssueDetailService(store, 'u0')) },
    { token: Steps, source: stepsSource(new StepService(store, board)) },
    {
      token: Compose,
      source: { view: { draft: compose.draft, filed: compose.filed }, commands: { save: d => compose.save(d), file: d => compose.file(d), discard: () => compose.discard() } }
    },
    { token: Views, source: { view: { views: views.views, saved: views.saved }, commands: { save: () => {}, rename: () => {}, remove: () => {} } } },
    { token: Palette, source: paletteSource(palette) },
    { token: Recent, source: recentSource(recent) },
    { token: References, source: referencesSource(new ReferenceService(store)) }
  ]);
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  services.register(ListPlaces);
  services.register(NewIssueService);
  services.register(CommandsService);
  ui = renderTest(createComponent(AppRoot), { channels: served.registry, width, height, services });
  ui.runtime.services.get(RouterService).setRoutes({ routes: ROUTES, notFound: TeamIssues });
  ui.runtime.services.get(RouterService).navigate(url);
  await settle();
}

/** Every text a node's subtree draws, joined. */
function textOf(node: { firstChild: unknown }): string {
  const parts: string[] = [];
  const walk = (n: any): void => {
    const text = n.properties?.get?.('text');
    if (typeof text === 'string') parts.push(text);
    for (let c = n.firstChild; c !== null; c = c.nextSibling) walk(c);
  };
  walk(node);
  return parts.join(' ');
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

it('walks a first visit through the workflow, a step at a time as each is done', async () => {
  await mount('/team/web/list');
  const step = () => textOf(ui.getByRole('region', { name: 'Tour' }));
  expect(step()).toContain('1 of 7');
  ui.fireEvent.press('x');
  await settle();
  expect(step()).toContain('2 of 7');
  ui.fireEvent.press('Enter');
  await settle();
  expect(ui.runtime.services.get(RouterService).url.value).toMatch(/^\/issue\//);
  expect(step()).toContain('3 of 7');
  // Next skips a step; ending it puts it away for good.
  ui.fireEvent.click(ui.getByRole('button', { name: 'Next step' }));
  await settle();
  expect(step()).toContain('4 of 7');
  ui.fireEvent.click(ui.getByRole('button', { name: 'End the tour' }));
  await settle();
  expect(ui.queryByRole('region', { name: 'Tour' })).toBeNull();
});

it("lifts the tour off the list with the theme's large shadow, in either scheme", async () => {
  await mount('/team/web/list');
  const shadows = () => ui.getByRole('region', { name: 'Tour' }).properties.get('boxShadows');
  const shell = ui.runtime.services.get(ShellService);
  shell.applyColorScheme('light');
  await settle();
  expect(shadows()).toBe(lightTheme.shadows.large);
  shell.applyColorScheme('dark');
  await settle();
  expect(shadows()).toBe(darkTheme.shadows.large);
});

describe('finishing the tour on its last step', () => {
  async function toLastStep(): Promise<void> {
    await mount('/team/web/list');
    for (let at = 1; at < 7; at++) {
      ui.fireEvent.click(ui.getByRole('button', { name: 'Next step' }));
      await settle();
    }
    expect(textOf(ui.getByRole('region', { name: 'Tour' }))).toContain('7 of 7');
  }

  it('puts it away when Done is clicked', async () => {
    await toLastStep();
    ui.fireEvent.click(ui.getByRole('button', { name: 'Finish the tour' }));
    await settle();
    expect(ui.queryByRole('region', { name: 'Tour' })).toBeNull();
  });

  it('puts it away when Done is pressed with Enter', async () => {
    await toLastStep();
    ui.fireEvent.focus(ui.getByRole('button', { name: 'Finish the tour' }));
    ui.fireEvent.press('Enter');
    await settle();
    expect(ui.queryByRole('region', { name: 'Tour' })).toBeNull();
  });
});

it('lays a list scroll out from the list, not from the shell', async () => {
  await mount('/team/web/list');
  const list = ui.getByRole('listbox', { name: 'Issues' });
  // A row mounting as the list scrolls changes nothing outside the
  // list's column: the regions above it all fill what's left.
  expect(ui.explainText(list)).toMatch(/relayout: boundary · content stays inside .*\(1 level up\)/);
});

it('opens an issue at its top, though the issue has the focus', async () => {
  await mount('/issue/WEB-12');
  const title = ui.getVisibleBox(ui.getByRole('textbox', { name: 'Title' }));
  expect(title.y).toBeGreaterThan(0);
  expect(title.y).toBeLessThan(200);
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

describe('stepping through a list from an issue, and back', () => {
  const url = () => ui.runtime.services.get(RouterService).url.value;
  const list = () => ui.getByRole('listbox', { name: 'Issues' });
  /** The key of the row under the list's cursor, as a screen reader hears it. */
  const cursorKey = (): string => {
    const id = ui.getSemantics(list()).activeDescendant;
    const row = ui.getAllByRole('option').find(node => node.id === id);
    return row === undefined ? '' : ui.getSemantics(row).label!.split(' ')[0]!;
  };
  /** Web's issues, as its list shows them. */
  const webOrder = () => runQuery(store.workspace, store.issues(), teamQuery('web')).ids.map(id => store.get(id)!.key);
  const position = () => ui.getSemantics(ui.getByRole('group', { name: 'Web › Issues' })).label;
  async function press(key: string, modifiers: { shift?: boolean; ctrl?: boolean } = {}): Promise<void> {
    ui.fireEvent.press(key, modifiers);
    await settle();
  }

  it('steps with j and k through the list the issue was opened from, and Escape goes back with the cursor on the last one', async () => {
    await mount('/team/web/list');
    const order = webOrder();
    await press('j');
    await press('Enter');
    expect(url()).toBe(`/issue/${order[1]}`);
    expect(textOf(ui.getByRole('group', { name: 'Web › Issues' }))).toContain(`2 of ${order.length}`);
    expect(ui.getSemantics(ui.getByText(`2 of ${order.length}`)).label).toBe(`Issue 2 of ${order.length} in Web › Issues`);

    await press('j');
    await press('j');
    expect(url()).toBe(`/issue/${order[3]}`);
    await press('k');
    expect(url()).toBe(`/issue/${order[2]}`);
    // The buttons do what the keys do.
    ui.fireEvent.click(ui.getByRole('button', { name: 'Next issue' }));
    await settle();
    expect(url()).toBe(`/issue/${order[3]}`);

    await press('Escape');
    expect(url()).toBe('/team/web/list');
    expect(cursorKey()).toBe(order[3]);
    // The cursor goes on from there.
    await press('j');
    expect(cursorKey()).toBe(order[4]);
  });

  it('has nowhere to go before the first issue', async () => {
    await mount('/team/web/list');
    await press('Enter');
    const first = url();
    expect(ui.getSemantics(ui.getByRole('button', { name: 'Previous issue' })).disabled).toBe(true);
    await press('k');
    expect(url()).toBe(first);
  });

  it('comes back scrolled where the list was, and scrolls only as far as it must to show an issue stepped to', async () => {
    await mount('/team/web/list');
    const box = ui.getVisibleBox(list());
    ui.fireEvent.wheel({ x: box.x + box.width / 2, y: box.y + 200, deltaY: 1200 });
    await settle();
    await settle();
    // A row well inside the list, opened with the pointer.
    const row = ui
      .getAllByRole('option')
      .find(node => ui.getVisibleBox(node).y > box.y + 200 && ui.getVisibleBox(node).y < box.y + 300)!;
    const key = ui.getSemantics(row).label!.split(' ')[0]!;
    const before = ui.getVisibleBox(row).y;
    ui.fireEvent.click(row);
    await settle();
    expect(url()).toBe(`/issue/${key}`);
    await press('Escape');
    const back = ui.getAllByRole('option').find(node => ui.getSemantics(node).label!.startsWith(`${key} `))!;
    expect(ui.getVisibleBox(back).y).toBe(before);
    expect(cursorKey()).toBe(key);

    // Stepped well past the bottom of what the list showed: it scrolls
    // just enough to show that one, at the bottom edge.
    ui.fireEvent.click(back);
    await settle();
    for (let i = 0; i < 25; i++) await press('j');
    const far = url().slice('/issue/'.length);
    await press('Escape');
    expect(cursorKey()).toBe(far);
    const shown = ui.getAllByRole('option').find(node => ui.getSemantics(node).label!.startsWith(`${far} `))!;
    const edge = ui.getVisibleBox(list());
    // Fractional sizes add up with float error, so to a hundredth of a pixel.
    const bottom = Math.round((ui.getVisibleBox(shown).y + ui.getVisibleBox(shown).height) * 100) / 100;
    expect(bottom).toBeLessThanOrEqual(edge.y + edge.height);
    expect(bottom).toBeGreaterThan(edge.y + edge.height - 40);
  });

  it('keeps the selection and the grouping chosen, there and back', async () => {
    await mount('/team/web/list');
    ui.fireEvent.click(ui.getByRole('combobox', { name: 'Group by' }));
    await settle();
    ui.fireEvent.click(ui.getAllByRole('option').find(node => ui.getSemantics(node).label === 'No grouping')!);
    await settle();
    await press('x');
    await press('j');
    await press('Enter');
    await press('j');
    await press('Escape');
    expect(ui.getSemantics(ui.getByRole('combobox', { name: 'Group by' })).valueText).toBe('No grouping');
    expect(ui.getByRole('toolbar', { name: 'Selected issues' })).toBeDefined();
    expect(ui.getAllByRole('option', { states: ['selected'] })).toHaveLength(1);
    // Stepped through the list as it was arranged: by priority, ungrouped.
    const order = runQuery(store.workspace, store.issues(), { ...teamQuery('web'), group: 'none' }).ids.map(id => store.get(id)!.key);
    expect(cursorKey()).toBe(order[2]);
  });

  it('comes back to a narrowed list narrowed, with its selection', async () => {
    await mount('/team/web/list?status=todo');
    const order = runQuery(store.workspace, store.issues(), { ...teamQuery('web'), refine: { stateIds: ['todo'] } }).ids.map(id => store.get(id)!.key);
    await press('x');
    await press('Enter');
    expect(textOf(ui.getByRole('group', { name: 'Web › Issues' }))).toContain(`1 of ${order.length}`);
    await press('j');
    expect(url()).toBe(`/issue/${order[1]}`);
    await press('Escape');
    expect(url()).toBe('/team/web/list?status=todo');
    expect(cursorKey()).toBe(order[1]);
    expect(ui.getAllByRole('option', { states: ['selected'] })).toHaveLength(1);
  });

  it('starts each issue stepped to at its top, drawn where it stays from its first frame', async () => {
    await mount('/team/web/list');
    const order = webOrder();
    await press('j');
    await press('Enter');
    const column = (): UiNode => ui.runtime.services.get(FocusService).focused.value!;
    const page = (): UiNode => {
      let node: UiNode | null = column();
      while (node !== null && node.type !== UiNodeType.ScrollView) node = node.parent;
      return node!;
    };
    /** One frame at a time, as a person would see them, from the step until the page is quiet. */
    async function watch(step: () => void, key: string) {
      const seen: { scroll: number; column: { x: number; y: number }; body: { x: number; y: number } }[] = [];
      step();
      for (let i = 0; i < 40; i++) {
        await served.settle();
        ui.frame();
        if (!url().endsWith(`/${key}`) || !(ui.getSemantics(column()).label ?? '').startsWith(`${key} `)) continue;
        const body = ui.getLayout(column().parent!);
        const box = ui.getLayout(column());
        seen.push({ scroll: ui.explain(page()).scroll!.scrollY, column: { x: box.x, y: box.y }, body: { x: body.x, y: body.y } });
      }
      return seen;
    }
    /** Down the page, as far as a wheel takes it. */
    async function scrollDown(): Promise<void> {
      const box = ui.getVisibleBox(page());
      ui.fireEvent.wheel({ x: box.x + box.width / 2, y: box.y + 200, deltaY: 600 });
      await settle();
      expect(ui.explain(page()).scroll!.scrollY).toBeGreaterThan(0);
    }

    await scrollDown();
    const clicked = await watch(() => ui.fireEvent.click(ui.getByRole('button', { name: 'Next issue' })), order[2]!);
    await scrollDown();
    const pressed = await watch(() => ui.fireEvent.press('j'), order[3]!);
    for (const frames of [clicked, pressed]) {
      expect(frames.length).toBeGreaterThan(0);
      // At the top from the first frame it's drawn on, and nothing
      // moves after it: no 16 px jump as the wide band's padding
      // arrives, no scroll as focus lands on the column.
      for (const frame of frames) expect(frame).toEqual(frames[0]);
      expect(frames[0]!.scroll).toBe(0);
      expect(frames[0]!.column).toEqual({ x: frames[0]!.body.x + 32, y: frames[0]!.body.y + 32 });
    }
  });

  it('leaves the keys to the title and the description while either has the caret', async () => {
    await mount('/team/web/list');
    await press('Enter');
    const here = url();
    ui.fireEvent.focus(ui.getByRole('textbox', { name: 'Title' }));
    await settle();
    ui.fireEvent.type('jk');
    await settle();
    expect(url()).toBe(here);
    expect(editorFor(ui.getByRole('textbox', { name: 'Title' })).text).toContain('jk');
    // Escape is the title's: it puts the title back, and stays.
    await press('Escape');
    expect(url()).toBe(here);
    expect(editorFor(ui.getByRole('textbox', { name: 'Title' })).text).not.toContain('jk');

    // The description's first block: the editor's text fields come after the title's.
    ui.fireEvent.focus(ui.getAllByRole('textbox')[1]!);
    await settle();
    await press('j');
    await press('Escape');
    expect(url()).toBe(here);
    // With the caret out of every field, Escape goes back.
    ui.fireEvent.blur();
    await press('Escape');
    expect(url()).toBe('/team/web/list');
  });

  it('closes an open menu or the palette with Escape before it leaves the page', async () => {
    await mount('/team/web/list');
    await press('Enter');
    const here = url();
    ui.fireEvent.click(ui.getByRole('combobox', { name: 'Priority' }));
    await settle();
    expect(ui.getByRole('listbox')).toBeDefined();
    await press('Escape');
    expect(url()).toBe(here);
    await press('k', { ctrl: true });
    expect(ui.getByRole('dialog')).toBeDefined();
    await press('Escape');
    expect(url()).toBe(here);
  });

  it("steps through the issue's team list when it wasn't opened from a list", async () => {
    await mount('/issue/WEB-12');
    const order = webOrder();
    const at = order.indexOf('WEB-12');
    expect(position()).toBe('Web › Issues');
    expect(textOf(ui.getByRole('group', { name: 'Web › Issues' }))).toContain(`${at + 1} of ${order.length}`);
    await press('j');
    expect(url()).toBe(`/issue/${order[at + 1]}`);
    await press('Escape');
    expect(url()).toBe('/team/web/list');
    expect(cursorKey()).toBe(order[at + 1]);
  });

  it('goes back to the board with its cursor on the card shown last', async () => {
    await mount('/team/web/board');
    const board = () => ui.getByRole('group', { name: 'Board' });
    await press('j');
    await press('Enter');
    const opened = url().slice('/issue/'.length);
    await press('j');
    const stepped = url().slice('/issue/'.length);
    expect(stepped).not.toBe(opened);
    expect(ui.getByRole('group', { name: 'Web › Board' })).toBeDefined();
    await press('Escape');
    expect(url()).toBe('/team/web/board');
    const active = ui.getSemantics(board()).activeDescendant;
    const card = ui.getAllByRole('listitem').find(node => node.id === active)!;
    expect(ui.getSemantics(card).label).toMatch(new RegExp(`^${stepped} `));
    expect(ui.runtime.input.focus.focusedNode).toBe(board());
  });
});

describe('the keyboard shortcut sheet', () => {
  const sheet = () => ui.queryByRole('dialog', { name: 'Keyboard shortcuts' });
  const rows = () => ui.getAllByRole('listitem').map(node => ui.getSemantics(node).label ?? '');
  const headings = () => ui.getAllByRole('heading').map(node => textOf(node));
  async function press(key: string, modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}): Promise<void> {
    ui.fireEvent.press(key, modifiers);
    await settle();
  }

  it('opens on ? with what works on this screen, a row for each thing with every key that does it', async () => {
    await mount('/team/web/list');
    await press('?', { shift: true });
    expect(sheet()).not.toBeNull();
    // The shell's own first, then the list's; no editor on a list.
    expect(headings()).toEqual(['Global', 'List']);
    // j and ↓ are one row, named the way a screen reader should say it.
    expect(rows()).toContain('Next issue, j or Down arrow');
    expect(rows()).toContain('Open the command palette, Control K');
    expect(rows()).toContain('Keyboard shortcuts, Question mark');
    expect(rows()).toContain('Go to the board, g then b');
    expect(rows().filter(row => row.startsWith('Next issue,'))).toHaveLength(1);
    // Drawn as caps: ↓ and Ctrl, K are caps of their own.
    const next = ui.getAllByRole('listitem').find(node => ui.getSemantics(node).label?.startsWith('Next issue,'))!;
    expect(textOf(next)).toBe('Next issue J or ↓');

    // ? again closes it, from the filter that has the caret; so does Escape.
    await press('?', { shift: true });
    expect(sheet()).toBeNull();
    await press('?', { shift: true });
    await press('Escape');
    expect(sheet()).toBeNull();
  });

  it('opens on ? however the layout types it', async () => {
    await mount('/team/web/list');
    // Unshifted, as on a layout with ? on a key of its own; then AltGr.
    await press('?');
    expect(sheet()).not.toBeNull();
    await press('Escape');
    await press('?', { ctrl: true, alt: true });
    expect(sheet()).not.toBeNull();
  });

  it("narrows to what's typed, by what it does or by its keys", async () => {
    await mount('/team/web/list');
    await press('?', { shift: true });
    ui.fireEvent.type('select');
    await settle();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every(row => /select/i.test(row))).toBe(true);
    for (let i = 0; i < 'select'.length; i++) await press('Backspace');
    ui.fireEvent.type('down arrow');
    await settle();
    expect(rows()).toEqual(['Next issue, j or Down arrow', 'Extend the selection down, Shift J or Shift Down arrow']);
    ui.fireEvent.type('zzz');
    await settle();
    expect(textOf(sheet()!)).toContain('No shortcut matches');
  });

  it("lists the editor's keys on an issue, which the editor handles itself", async () => {
    await mount('/issue/WEB-12');
    await press('?', { shift: true });
    expect(headings().at(-1)).toBe('Editor');
    expect(rows()).toContain('Bold, Control B');
    expect(rows()).toContain('Strikethrough, Control Shift X');
    expect(rows()).toContain('Leave the editor, Escape then Tab');
    expect(rows()).toContain('Mention someone, @');
    expect(rows()).toContain('Next issue, j');
  });

  it('is not opened by a ? typed into a field', async () => {
    await mount('/team/web/list');
    const search = ui.getByRole('textbox', { name: 'Search issues' });
    ui.fireEvent.focus(search);
    await settle();
    expect(ui.runtime.input.focus.focusedNode).toBe(search);
    await press('?', { shift: true });
    expect(sheet()).toBeNull();
  });

  it('opens from the palette, which finds it by "help", and from the top bar', async () => {
    await mount('/team/web/list');
    await press('k', { ctrl: true });
    ui.fireEvent.type('keyboard shortcuts');
    await settle();
    await press('Enter');
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    expect(sheet()).not.toBeNull();
    await press('Escape');

    const palette = ui.runtime.services.get(CommandsService);
    const catalog = () => ui.getAllByRole('option').map(node => ui.getSemantics(node).label);
    await press('k', { ctrl: true });
    ui.fireEvent.type('help');
    await settle();
    expect(catalog()).toContain('Keyboard shortcuts');
    await press('Escape');
    expect(palette.open.value).toBe(false);

    ui.fireEvent.click(ui.getByRole('button', { name: 'Keyboard shortcuts' }));
    await settle();
    expect(sheet()).not.toBeNull();
  });
});

describe('the keyboard shortcut sheet in a short window', () => {
  const dialogBox = (name: string) => ui.getLayout(ui.getByRole('dialog', { name }));

  /** The keyboard shortcut sheet's scrolling list. */
  function sheetList(): UiNode {
    let node: UiNode | null = ui.getAllByRole('list')[0]!;
    while (node !== null && node.type !== UiNodeType.ScrollView) node = node.parent;
    return node!;
  }

  it('gives the shortcut list the room there is, with the filter in view', async () => {
    await mount('/team/web/list', 375, 500);
    ui.fireEvent.press('?', { shift: true });
    await settle();
    const dialog = dialogBox('Keyboard shortcuts');
    expect(dialog.y).toBeGreaterThanOrEqual(16);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(500 - 16);
    const filter = ui.getVisibleBox(ui.getByRole('searchbox', { name: 'Filter shortcuts' }));
    expect(filter.y).toBeGreaterThan(dialog.y);
    // Less than the 420 it asks for, and inside the dialog: the list
    // scrolls itself rather than the dialog scrolling the filter away.
    const list = ui.getLayout(sheetList());
    expect(list.height).toBeLessThan(420);
    expect(list.y + list.height).toBeLessThanOrEqual(dialog.y + dialog.height);
  });

  it('keeps the shortcut list its own height where there is room, however a filter shortens it', async () => {
    await mount('/team/web/list');
    ui.fireEvent.press('?', { shift: true });
    await settle();
    const list = sheetList();
    const before = { dialog: dialogBox('Keyboard shortcuts'), list: ui.getLayout(list) };
    expect(before.list.height).toBe(420);
    ui.fireEvent.type('zzz');
    await settle();
    expect(textOf(ui.getByRole('dialog', { name: 'Keyboard shortcuts' }))).toContain('No shortcut matches');
    expect({ dialog: dialogBox('Keyboard shortcuts'), list: ui.getLayout(list) }).toEqual(before);
  });
});

describe('the tour and a dialog on a narrow window', () => {
  it('draws the dialog over the tour, and a press on the tour reaches neither its buttons nor the page', async () => {
    await mount('/team/web/list', 375, 640);
    const tour = () => ui.getByRole('region', { name: 'Tour' });
    expect(textOf(tour())).toContain('1 of 7');
    ui.fireEvent.press('c');
    await settle();
    // Past the dialog's entrance, which takes no presses at opacity 0.
    ui.frame(10_000);
    await settle();

    // One frame's drawing: the tour first, the dialog over it.
    ui.clearDraws();
    ui.runtime.resize(375, 641);
    ui.frame();
    const texts = ui.draws.filter(call => call.name === 'fillText').map(call => String(call.args[0]));
    expect(texts.indexOf('Next')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Next')).toBeLessThan(texts.lastIndexOf('New issue'));

    // A press on the tour's Next lands on the dialog or its backdrop,
    // which closes the dialog: the tour stays on its step.
    const next = ui.getVisibleBox(ui.getByRole('button', { name: 'Next step' }));
    ui.fireEvent.pointerDown(next.x + next.width / 2, next.y + next.height / 2);
    ui.fireEvent.pointerUp(next.x + next.width / 2, next.y + next.height / 2);
    await settle();
    expect(textOf(tour())).toContain('1 of 7');
  });

  it('keeps the tour in the corner of a window that was widened', async () => {
    // Gesso placed it against the window it was first laid out in: widened
    // from a phone's width, the card stayed on the left, over the sidebar.
    await mount('/team/web/list', 375, 640);
    ui.runtime.resize(1280, 640);
    await settle();
    const card = ui.getLayout(ui.getByRole('region', { name: 'Tour' }));
    expect(card.x + card.width).toBe(1280 - 16);
  });
});
