import { combineLatest, type Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { darkTheme, lightTheme, percent, shortcut, shortcuts, type UiChild } from 'gesso-core';
import { SegmentedControl, SplitPane } from 'gesso-components';
import { RouterService, ShellService, type ComponentContext, type Inputs, type OutletProps } from 'gesso-framework';

import { Issues } from '../issues/IssuesContract';
import { Preferences, type ThemeChoice } from './PreferencesContract';
import { ShortcutsService } from './ShortcutsService';
import { NewIssueDialog } from '../compose/NewIssueDialog';
import { NewIssueService } from '../compose/NewIssueService';
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

  const theme = resolveTheme(prefs.view.theme, shell.colorScheme).pipe(map(scheme => (scheme === 'dark' ? darkTheme : lightTheme)));

  const global = (keys: string, label: string, run: () => void) => shortcut({ registry, keys, label, scoped: false, run });

  const main = (
    // minWidth 0: without it a board five columns wide sets the pane's
    // minimum, and the pane pushes the top bar's controls off screen.
    <column flexGrow={1} minWidth={0} width={percent(100)} height={percent(100)} x="stretch" role="main" label="Main">
      <TopBar />
      <NewIssueDialog open={newIssue.open} onClose={() => (newIssue.open.value = false)} />
      <box height={1} backgroundColor="border" />
      {/* minHeight 0 too: without it a page taller than the window sets the
          box's minimum height, and the page's own scroll view never scrolls. */}
      <box flexGrow={1} minWidth={0} minHeight={0} x="stretch" y="stretch">
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
        global('Mod+\\', 'Show or hide the sidebar', () => prefs.send.setSidebarOpen(!prefs.view.sidebarOpen.value)),
        global('g m', 'Go to my issues', () => router.navigate('/my-issues')),
        global('g l', 'Go to the list', () => router.navigate(`/team/${currentTeam(router)}/list`)),
        global('g b', 'Go to the board', () => router.navigate(`/team/${currentTeam(router)}/board`)),
        global('c', 'New issue', () => (newIssue.open.value = true))
      ]}>
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
}

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
