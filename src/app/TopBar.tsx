import { BehaviorSubject, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';

import { Button, SegmentedControl } from 'gesso-components';
import { RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import { Issues } from '../issues/IssuesContract';
import { BUILT_IN_VIEWS } from './Sidebar';
import { WorkspaceMeta, type WorkspaceView } from './WorkspaceContract';

interface Place {
  readonly title: string;
  /** The team whose list and board the switcher moves between, when there is one. */
  readonly team: string | null;
  readonly view: 'list' | 'board' | null;
}

/** What the url means, in words. */
export function placeOf(url: string, meta: WorkspaceView): Place {
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
  if (view !== null) return { title: BUILT_IN_VIEWS.find(v => v.id === view[1])?.name ?? 'View', team: null, view: null };
  if (path === '/my-issues') return { title: 'My issues', team: null, view: null };
  if (path.startsWith('/spike/')) return { title: 'Phase 0 › Markdown editor', team: null, view: null };
  return { title: '', team: null, view: null };
}

export function TopBar(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const router = ctx.inject(RouterService);
  const meta = ctx.channel(WorkspaceMeta);
  const issues = ctx.channel(Issues);

  const place = new BehaviorSubject<Place>({ title: '', team: null, view: null });
  ctx.effect(combineLatest([router.url, meta.view.teams, meta.view.projects]), ([url]) =>
    place.next(placeOf(url, snapshot(meta.view)))
  );

  return (
    <row height={48} paddingLeft={16} paddingRight={12} gap={12} y="center" x="space-between" role="banner" label="Top bar">
      <text text={place.pipe(map(p => p.title))} fontSize={14} fontWeight={600} color="text" maxLines={1} flexShrink={1} />
      <row gap={8} y="center">
        {/* One switcher whose value follows the url, hidden off team pages, rather than a new one per team. */}
        <box visible={place.pipe(map(p => p.team !== null))}>
          <SegmentedControl
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
        </box>
        <Button
          label={issues.view.undoLabel.pipe(map(label => (label === null ? 'Nothing to undo' : `Undo: ${label}`)))}
          disabled={issues.view.undoLabel.pipe(map(label => label === null))}
          size="small"
          variant="plain"
          onClick={() => issues.send.undo()}>
          <text text="Undo" fontSize={12} color="text" />
        </Button>
      </row>
    </row>
  );
}

function snapshot(view: { [K in keyof WorkspaceView]: { value: WorkspaceView[K] } }): WorkspaceView {
  return {
    teams: view.teams.value,
    states: view.states.value,
    users: view.users.value,
    labels: view.labels.value,
    projects: view.projects.value,
    me: view.me.value
  };
}
