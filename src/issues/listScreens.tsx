import { map } from 'rxjs/operators';

import { RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

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
  const query = routeParam(router, 'id').pipe(map(id => VIEW_QUERIES[id ?? 'all'] ?? VIEW_QUERIES.all!));
  return <IssueList query={query} empty="No issues match this view" />;
}

