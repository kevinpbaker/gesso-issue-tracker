import { BehaviorSubject, combineLatest, type Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { darkTheme, lightTheme, percent, Responsive, shortcut, shortcuts, withContrast, type UiChild } from 'gesso-core';
import { SegmentedControl, SplitPane } from 'gesso-components';
import { RouterService, ShellService, type ComponentContext, type Inputs, type OutletProps } from 'gesso-framework';

import { Issues } from '../issues/IssuesContract';
import { Preferences, type ThemeChoice } from './PreferencesContract';
import { ShortcutsService } from './ShortcutsService';
import { NewIssueDialog } from '../compose/NewIssueDialog';
import { NewIssueService } from '../compose/NewIssueService';
import { CommandPalette } from '../palette/CommandPalette';
import { CommandsService, type PaletteCommand } from '../palette/CommandsService';
import { Views } from '../views/ViewsContract';
import { WorkspaceMeta } from './WorkspaceContract';
import { BUILT_IN_VIEWS } from './Sidebar';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * The layout every screen renders inside: a sidebar, a top bar, and
 * the outlet.
 *
 * It is the `Shell` route's screen, so it is built once and stays
 * mounted while the screens in its outlet change. It owns the theme,
 * resolved from the saved preference and what the platform reports,
 * and provided as an environment value, so nothing below names a
 * colour that isn't a token. And it owns the shortcuts that work
 * everywhere: undo, redo, the sidebar, and `g` chords to move around.
 */
export function AppShell(inputs: Inputs<OutletProps>, ctx: ComponentContext) {
  const prefs = ctx.channel(Preferences);
  const issues = ctx.channel(Issues);
  const shell = ctx.inject(ShellService);
  const router = ctx.inject(RouterService);
  const { registry } = ctx.inject(ShortcutsService);
  const newIssue = ctx.inject(NewIssueService);
  const palette = ctx.inject(CommandsService);
  const meta = ctx.channel(WorkspaceMeta);
  const views = ctx.channel(Views);

  // What the whole app can do, wherever it is: go anywhere, file an
  // issue, change how it looks. Screens add what applies to them.
  ctx.onUnmount(
    palette.register((): PaletteCommand[] => {
      const go = (id: string, label: string, href: string, keywords?: string): PaletteCommand => ({
        id: `go:${id}`,
        label,
        group: 'Go to',
        keywords,
        run: () => router.navigate(href)
      });
      const teams = meta.view.teams.value.flatMap(team => [
        go(`team-${team.id}`, `${team.name} issues`, `/team/${team.id}/list`, `${team.key} list`),
        go(`board-${team.id}`, `${team.name} board`, `/team/${team.id}/board`, `${team.key} kanban`)
      ]);
      const viewList = [...BUILT_IN_VIEWS, ...views.view.views.value].map(view => go(`view-${view.id}`, `${view.name} (view)`, `/view/${view.id}`));
      const projects = meta.view.projects.value.map(project => {
        const team = meta.view.teams.value.find(t => t.id === project.teamId);
        return go(`project-${project.id}`, `${project.name} (${team?.key ?? ''} project)`, `/project/${project.id}`);
      });
      const theme = (choice: ThemeChoice, label: string): PaletteCommand => ({
        id: `theme:${choice}`,
        label,
        group: 'Appearance',
        keywords: 'theme colour color mode',
        run: () => prefs.send.setTheme(choice)
      });
      return [
        go('my-issues', 'My issues', '/my-issues'),
        ...teams,
        ...viewList,
        ...projects,
        go('editor', 'The sample document', '/editor'),
        theme('light', 'Use the light theme'),
        theme('dark', 'Use the dark theme'),
        theme('system', 'Follow the system theme'),
        { id: 'reset', label: 'Reset the workspace to its seed', group: 'Workspace', keywords: 'start over clear', run: () => issues.send.reset() }
      ];
    })
  );
  // A canvas gets nothing from forced colours, so a person who asked the
  // system for more contrast gets the raised palette from here.
  const theme = combineLatest([resolveTheme(prefs.view.theme, shell.colorScheme), shell.contrast]).pipe(
    map(([scheme, contrast]) => withContrast(scheme === 'dark' ? darkTheme : lightTheme, contrast))
  );

  const global = (keys: string, label: string, run: () => void) => shortcut({ registry, keys, label, scoped: false, run });

  // Below NARROW (a phone, or a window zoomed to 200% and more) there is
  // no room for the sidebar beside the page, so it takes the page's
  // place while it's open, from the top bar's Menu button, and closes
  // when a destination is chosen.
  const narrowNow = new BehaviorSubject(false);
  let narrow = false;
  const drawer = new BehaviorSubject(false);
  ctx.effect(router.url, () => drawer.next(false));
  const closeDrawer = () => drawer.next(false);

  const main = (
    // minWidth 0: without it a board five columns wide sets the pane's
    // minimum, and the pane pushes the top bar's controls off screen.
    <column flexGrow={1} minWidth={0} width={percent(100)} height={percent(100)} x="stretch" role="main" label="Main">
      <TopBar menu={narrowNow} onMenu={() => drawer.next(true)} />
      <NewIssueDialog open={newIssue.open} onClose={() => (newIssue.open.value = false)} />
      <CommandPalette />
      <box height={1} backgroundColor="border" />
      {/* minHeight 0 too: without it a page taller than the window sets the
          box's minimum height, and the page's own scroll view never scrolls.
          And a basis of 0, so the page's content isn't what the column
          shares out: with it, a long list squeezed the top bar. */}
      <box flexGrow={1} flexBasis={0} minWidth={0} minHeight={0} x="stretch" y="stretch">
        {inputs.outlet as UiChild}
      </box>
    </column>
  );

  return (
    <row
      theme={theme}
      textStyle={theme.pipe(map(value => value.typography.body))}
      backgroundColor="background"
      width={percent(100)}
      height={percent(100)}
      y="stretch"
      modifiers={[
        shortcuts({ registry }),
        global('Mod+Z', 'Undo', () => issues.send.undo()),
        global('Mod+Shift+Z', 'Redo', () => issues.send.redo()),
        global('Mod+\\', 'Show or hide the sidebar', () =>
          narrow ? drawer.next(!drawer.value) : prefs.send.setSidebarOpen(!prefs.view.sidebarOpen.value)
        ),
        global('g m', 'Go to my issues', () => router.navigate('/my-issues')),
        global('g l', 'Go to the list', () => router.navigate(`/team/${currentTeam(router)}/list`)),
        global('g b', 'Go to the board', () => router.navigate(`/team/${currentTeam(router)}/board`)),
        // Both open over the page, so a sidebar standing in for it closes first.
        global('c', 'New issue', () => {
          closeDrawer();
          newIssue.open.value = true;
        }),
        global('Mod+K', 'Open the command palette', () => {
          closeDrawer();
          palette.open.value = !palette.open.value;
        })
      ]}>
      {Responsive({ at: [NARROW], as: 'row', flexGrow: 1, flexBasis: 0, minWidth: 0, y: 'stretch' }, size => {
        narrow = size.width < NARROW;
        narrowNow.next(narrow);
        if (narrow) {
          return (
            <row key="narrow" flexGrow={1} minWidth={0} y="stretch">
              {drawer.pipe(map(open => (open ? <Sidebar key="drawer" onClose={closeDrawer} /> : main)))}
            </row>
          );
        }
        closeDrawer();
        return (
          <row key="wide" flexGrow={1} minWidth={0} y="stretch">
            {prefs.view.sidebarOpen.pipe(
              map(open =>
                open ? (
                  <SplitPane
                    key="split"
                    flexGrow={1}
                    label="Sidebar"
                    split={prefs.view.sidebarSplit}
                    onSplitChange={split => prefs.send.setSidebarSplit(split)}
                    min={0.12}
                    max={0.4}
                    first={<Sidebar />}
                    second={main}
                  />
                ) : (
                  main
                )
              )
            )}
          </row>
        );
      })}
    </row>
  );
}

/** The width, in CSS pixels, below which the sidebar stops sitting beside the page. */
export const NARROW = 720;

/** The team in the url, or the Web team when the url names none. */
export function currentTeam(router: RouterService): string {
  const match = /^\/team\/([^/]+)/.exec(router.url.value);
  return match?.[1] ?? 'web';
}

function resolveTheme(choice: Observable<ThemeChoice>, platform: Observable<'light' | 'dark'>) {
  return combineLatest([choice, platform]).pipe(
    map(([chosen, reported]) => (chosen === 'system' ? reported : chosen)),
    distinctUntilChanged()
  );
}

/** Light, dark, or whatever the system says. */
export function ThemeSwitch(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const prefs = ctx.channel(Preferences);
  return (
    <SegmentedControl
      label="Appearance"
      size="small"
      value={prefs.view.theme}
      onChange={next => prefs.send.setTheme(next as ThemeChoice)}
      options={[
        { value: 'system', label: 'Auto' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' }
      ]}
    />
  );
}
