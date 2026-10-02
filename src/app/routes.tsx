import { percent } from 'gesso-core';
import { createComponent, route, RouterOutlet, to, type ComponentContext, type Inputs, type RouteContext, type RouteTarget } from 'gesso-framework';

import { BoardRoute } from '../board/BoardRoute';
import { IssueScreen } from '../detail/IssueScreen';
import { bigDocument } from '../editor/bigDocument';
import { EditorSpike } from '../editor/EditorSpike';
import { MyIssuesScreen, ProjectScreen, TeamIssuesScreen, ViewScreen } from '../issues/listScreens';
import { AppShell } from './AppShell';

/**
 * Every address the tracker answers to.
 *
 * Paths are written out in full, which is what types the params:
 * `router.go(TeamBoard, { key: 'web' })` is checked against
 * `/team/:key/board`. Everything nests inside `Shell`, the layout with
 * the sidebar and the top bar, which stays mounted while the screens
 * inside it change, so the sidebar keeps its scroll and its focus.
 *
 * The routes live here, in the render worker, because a route holds a
 * component; the shell only reports and pushes urls.
 */

export const Shell = route({
  path: '/',
  component: AppShell,
  // `/` on its own is not a screen: it is the Web team's issues.
  guard: ({ url }: RouteContext<'/'>): RouteTarget | boolean => (url === '/' || url.startsWith('/?') ? to(TeamIssues, { key: 'web' }) : true)
});

export const MyIssues = route({ path: '/my-issues', component: MyIssuesScreen, parent: Shell });
export const TeamIssues = route({ path: '/team/:key/list', component: TeamIssuesScreen, parent: Shell });
export const TeamBoard = route({ path: '/team/:key/board', component: BoardRoute, parent: Shell });
export const IssuePage = route({ path: '/issue/:key', component: IssueScreen, parent: Shell });
export const ProjectPage = route({ path: '/project/:id', component: ProjectScreen, parent: Shell });
export const ViewPage = route({ path: '/view/:id', component: ViewScreen, parent: Shell });

function EditorSpikeScreen(_inputs: Inputs<{}>, _ctx: ComponentContext) {
  return <EditorSpike />;
}
function BigEditorSpikeScreen(_inputs: Inputs<{}>, _ctx: ComponentContext) {
  return <EditorSpike markdown={bigDocument()} showSource={false} />;
}
export const EditorSpikePage = route({ path: '/spike/editor', component: EditorSpikeScreen, parent: Shell });
export const BigEditorSpikePage = route({ path: '/spike/editor-5000', component: BigEditorSpikeScreen, parent: Shell });

export const ROUTES = [
  Shell,
  MyIssues,
  TeamIssues,
  TeamBoard,
  IssuePage,
  ProjectPage,
  ViewPage,
  EditorSpikePage,
  BigEditorSpikePage
];

/**
 * The root: an outlet in a box. `RouterOutlet` cannot be the root
 * itself, because a route change is an observable emission and a root
 * has to be a node.
 */
export function AppRoot(_inputs: Inputs<{}>, _ctx: ComponentContext) {
  return (
    <column width={percent(100)} height={percent(100)}>
      {createComponent(RouterOutlet)}
    </column>
  );
}
