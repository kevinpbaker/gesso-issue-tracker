import { combineLatest } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { percent } from 'gesso-core';
import { Button } from 'gesso-components';

import { internalState, RouterService, type ComponentContext, type Inputs } from 'gesso-framework';
import { SaveViewDialog } from '../views/SaveViewDialog';
import { Views, type SavedView } from '../views/ViewsContract';

import { routeParam } from '../app/params';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import { DEFAULT_QUERY, type IssueQuery } from '../model/query';
import { IssueList } from './IssueList';

/**
 * The screens that are a list with a fixed query. Each reads its params
 * from the router and hands `IssueList` a query; a walk from one team to
 * another changes the params, not the screen, so the list follows the
 * new query without being rebuilt.
 */

export function TeamIssuesScreen(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const router = ctx.inject(RouterService);
  const query = routeParam(router, 'key').pipe(
    map((key): IssueQuery => ({ ...DEFAULT_QUERY, filter: { teamIds: [key ?? 'web'] } }))
  );
  return <IssueList query={query} empty="This team has no issues" />;
}

export function MyIssuesScreen(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const meta = ctx.channel(WorkspaceMeta);
  const query = meta.view.me.pipe(
    map((me): IssueQuery => ({
      filter: { assigneeIds: [me], stateIds: ['todo', 'in-progress', 'in-review'] },
      sort: { field: 'priority', direction: 'asc' },
      group: 'state'
    }))
  );
  return <IssueList query={query} empty="Nothing assigned to you is open" />;
}

export function ProjectScreen(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const router = ctx.inject(RouterService);
  const query = routeParam(router, 'id').pipe(
    map((id): IssueQuery => ({ ...DEFAULT_QUERY, filter: { projectIds: [id ?? ''] } }))
  );
  return <IssueList query={query} empty="This project has no issues" />;
}

/** The views that ship with the workspace, by ID. */
export const VIEW_QUERIES: Record<string, IssueQuery> = {
  all: { filter: {}, sort: { field: 'updatedAt', direction: 'desc' }, group: 'team' },
  active: { filter: { stateIds: ['in-progress', 'in-review'] }, sort: { field: 'priority', direction: 'asc' }, group: 'assignee' },
  backlog: { filter: { stateIds: ['backlog'] }, sort: { field: 'createdAt', direction: 'desc' }, group: 'team' },
  urgent: { filter: { priorities: [1], stateIds: ['backlog', 'todo', 'in-progress', 'in-review'] }, sort: { field: 'updatedAt', direction: 'desc' }, group: 'team' }
};

export function ViewScreen(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const router = ctx.inject(RouterService);
  const views = ctx.channel(Views);
  const id = routeParam(router, 'id').pipe(map(value => value ?? 'all'));
  const saved = combineLatest([id, views.view.views]).pipe(map(([key, list]) => list.find(view => view.id === key) ?? null));
  const query = combineLatest([id, saved]).pipe(
    map(([key, view]) => view?.query ?? VIEW_QUERIES[key] ?? VIEW_QUERIES.all!),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );
  return (
    <column width={percent(100)} height={percent(100)}>
      {saved.pipe(
        distinctUntilChanged((a, b) => a?.id === b?.id && a?.name === b?.name),
        map(view => (view === null ? [] : [<SavedViewBar key={view.id} view={view} />]))
      )}
      <IssueList query={query} empty="No issues match this view" />
    </column>
  );
}

/** A saved view's own controls: rename it, or delete it and go back to all issues. */
function SavedViewBar(inputs: Inputs<{ view: SavedView }>, ctx: ComponentContext) {
  const views = ctx.channel(Views);
  const router = ctx.inject(RouterService);
  const renaming = internalState(false);
  const view = inputs.view.value;
  return (
    <row gap={8} paddingLeft={16} paddingRight={16} paddingTop={8} y="center" role="group" label={`${view.name}, a saved view`}>
      <text text="Saved view" fontSize={12} color="textMuted" flexGrow={1} />
      <Button size="small" variant="plain" label="Rename the view" onClick={() => (renaming.value = true)}>
        <text text="Rename" fontSize={12} color="textMuted" />
      </Button>
      <Button
        size="small"
        variant="plain"
        label="Delete the view"
        onClick={() => {
          views.send.remove(view.id);
          router.navigate('/view/all');
        }}>
        <text text="Delete" fontSize={12} color="danger" />
      </Button>
      <SaveViewDialog open={renaming} onClose={() => (renaming.value = false)} query={null} rename={{ id: view.id, name: view.name }} />
    </row>
  );
}

