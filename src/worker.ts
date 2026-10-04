/**
 * The render worker: everything the person sees.
 *
 * Channels with no worker named resolve to the application worker the
 * shell spawned (`AppWorker.ts`). The routes are registered here because
 * a route holds a component, which cannot cross `postMessage`.
 */
import { renderRoot } from 'gesso-framework';

import { Preferences } from './app/PreferencesContract';
import { AppRoot, ROUTES, TeamIssues } from './app/routes';
import { ShortcutsService } from './app/ShortcutsService';
import { Compose } from './compose/ComposeContract';
import { Views } from './views/ViewsContract';
import { CommandsService } from './palette/CommandsService';
import { Palette } from './palette/PaletteContract';
import { Recent } from './recent/RecentContract';
import { References } from './references/ReferencesContract';
import { NewIssueService } from './compose/NewIssueService';
import { WorkspaceMeta } from './app/WorkspaceContract';
import { Board } from './board/BoardContract';
import { IssueDetailChannel } from './detail/IssueDetailContract';
import { Steps } from './detail/StepsContract';
import { Issues } from './issues/IssuesContract';
import { ListPlaces } from './issues/ListPlaces';

renderRoot(AppRoot)
  .useChannel(WorkspaceMeta)
  .useChannel(Preferences)
  .useChannel(Board)
  .useChannel(Issues)
  .useChannel(IssueDetailChannel)
  .useChannel(Steps)
  .useChannel(Compose)
  .useChannel(Views)
  .useChannel(Palette)
  .useChannel(Recent)
  .useChannel(References)
  .useService(ShortcutsService)
  .useService(NewIssueService)
  .useService(CommandsService)
  .useService(ListPlaces)
  .useRoutes({ routes: ROUTES, notFound: TeamIssues });
