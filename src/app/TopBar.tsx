import { BehaviorSubject, combineLatest } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { Button, SegmentedControl } from 'gesso-components';
import type { UiNode } from 'gesso-core';
import { RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import { Issues } from '../issues/IssuesContract';
import { NewIssueService } from '../compose/NewIssueService';
import { Views } from '../views/ViewsContract';
import { KEYBOARD_SHORTCUTS, ShortcutsService } from './ShortcutsService';
import { BUILT_IN_VIEWS } from './Sidebar';
import { WorkspaceMeta, type WorkspaceView } from './WorkspaceContract';

interface Place {
  readonly title: string;
  /** The team whose list and board the switcher moves between, when there is one. */
  readonly team: string | null;
  readonly view: 'list' | 'board' | null;
}

/** What the url means, in words. */
export function placeOf(
  url: string,
  meta: Pick<WorkspaceView, 'teams' | 'projects'>,
  saved: readonly { readonly id: string; readonly name: string }[] = []
): Place {
  const path = url.split('?')[0]!;
  const team = /^\/team\/([^/]+)\/(list|board)$/.exec(path);
  if (team !== null) {
    const name = meta.teams.find(t => t.id === team[1])?.name ?? team[1]!;
    return { title: `${name} › ${team[2] === 'list' ? 'Issues' : 'Board'}`, team: team[1]!, view: team[2] as 'list' | 'board' };
  }
  const issue = /^\/issue\/([^/]+)$/.exec(path);
  if (issue !== null) return { title: decodeURIComponent(issue[1]!).toUpperCase(), team: null, view: null };
  const project = /^\/project\/([^/]+)$/.exec(path);
  if (project !== null) {
    const found = meta.projects.find(p => p.id === project[1]);
    const team = meta.teams.find(t => t.id === found?.teamId);
    return { title: found === undefined ? 'Project' : `${team?.name ?? ''} › ${found.name}`, team: null, view: null };
  }
  const view = /^\/view\/([^/]+)$/.exec(path);
  if (view !== null) {
    const name = BUILT_IN_VIEWS.find(v => v.id === view[1])?.name ?? saved.find(v => v.id === view[1])?.name ?? 'View';
    return { title: name, team: null, view: null };
  }
  if (path === '/my-issues') return { title: 'My issues', team: null, view: null };
  if (path.startsWith('/spike/')) return { title: 'Phase 0 › Markdown editor', team: null, view: null };
  return { title: '', team: null, view: null };
}

/**
 * `menu` is true while the sidebar isn't beside the page: a Menu button
 * then opens it, and `menuRef` is handed that button, for the keyboard
 * to go back to when the sidebar is put away.
 */
export function TopBar(inputs: Inputs<{ menu?: boolean; onMenu?: () => void; menuRef?: (node: UiNode | null) => void }>, ctx: ComponentContext) {
  const router = ctx.inject(RouterService);
  const meta = ctx.channel(WorkspaceMeta);
  const issues = ctx.channel(Issues);
  const newIssue = ctx.inject(NewIssueService);
  const views = ctx.channel(Views);
  const keys = ctx.inject(ShortcutsService);

  const place = new BehaviorSubject<Place>({ title: '', team: null, view: null });
  ctx.effect(combineLatest([router.url, meta.view.teams, meta.view.projects, views.view.views]), ([url, teams, projects, saved]) =>
    place.next(placeOf(url, { teams, projects }, saved))
  );

  // One wrapping row rather than two groups pushed apart: where the
  // controls don't fit beside the breadcrumb (a phone, or a window zoomed
  // to 400%), they go onto a line of their own under it, and onto a third
  // if one line can't hold them, rather than over it or off the edge. The
  // breadcrumb keeps room to be read, and truncates past that.
  return (
    <row
      minHeight={48}
      flexShrink={0}
      paddingLeft={16}
      paddingRight={12}
      paddingY={10}
      columnGap={8}
      rowGap={8}
      y="center"
      flexWrap="wrap"
      role="banner"
      label="Top bar">
      <row gap={8} y="center" flexGrow={1} flexShrink={1} flexBasis={160} minWidth={0} marginRight={4}>
        {inputs.menu.pipe(
          map(menu =>
            menu === true
              ? [
                  <Button
                    key="menu"
                    ref={(node: UiNode | null) => inputs.menuRef.value?.(node)}
                    label="Menu"
                    description={'Mod+\\'}
                    size="small"
                    variant="plain"
                    flexShrink={0}
                    onClick={() => inputs.onMenu.value?.()}>
                    <text text="Menu" fontSize={12} color="text" />
                  </Button>
                ]
              : []
          )
        )}
        <text text={place.pipe(map(p => p.title))} fontSize={14} fontWeight={600} color="text" maxLines={1} textOverflow="ellipsis" flexShrink={1} />
      </row>
      {/* One switcher whose value follows the url, built on the way onto
          a team page rather than once per team. Off them it's taken out
          rather than hidden, which would keep its room in the row. */}
      {place.pipe(
        map(p => p.team !== null),
        distinctUntilChanged(),
        map(onTeam =>
          onTeam
            ? [
                <SegmentedControl
                  key="layout"
                  label="Layout"
                  size="small"
                  value={place.pipe(map(p => p.view ?? 'list'))}
                  onChange={next => {
                    const team = place.value?.team;
                    if (team) router.navigate(`/team/${team}/${next}`);
                  }}
                  options={[
                    { value: 'list', label: 'List' },
                    { value: 'board', label: 'Board' }
                  ]}
                />
              ]
            : []
        )
      )}
      <Button label="New issue" description="C" size="small" onClick={() => (newIssue.open.value = true)}>
        <text text="New issue" fontSize={12} color="background" />
      </Button>
      <Button
        label={issues.view.undoLabel.pipe(map(label => (label === null ? 'Nothing to undo' : `Undo: ${label}`)))}
        disabled={issues.view.undoLabel.pipe(map(label => label === null))}
        size="small"
        variant="plain"
        onClick={() => issues.send.undo()}>
        <text text="Undo" fontSize={12} color="text" />
      </Button>
      {/* The way to find the shortcuts besides the palette, and a hint that `?` opens it. */}
      <Button label={KEYBOARD_SHORTCUTS} description="?" size="small" variant="plain" onClick={() => (keys.sheetOpen.value = true)}>
        <text text="?" fontSize={12} fontWeight={600} color="textMuted" />
      </Button>
    </row>
  );
}
