/**
 * The application worker, named where `gesso-vite-plugin` looks for it.
 *
 * One `IssueStore` holds the workspace: 50,000 seeded issues with
 * whatever this browser has changed laid over them from IndexedDB. The
 * board and the issue list are two views of it, served as two channels,
 * so a card dragged on the board is the same edit, the same undo and
 * the same saved change as a status set from the list.
 *
 * `serveChannels` is called synchronously, before any await, so the
 * render worker's first sync is never missed. The overlay arrives a
 * moment later and the views follow it like any other change.
 */
import { serveChannels } from 'gesso-framework';
import { IndexedDbStorage } from 'gesso-framework/worker';

import { Preferences } from './app/PreferencesContract';
import { PreferencesStore } from './app/PreferencesStore';
import { WorkspaceMeta } from './app/WorkspaceContract';
import { workspaceSource } from './app/workspaceSource';
import { Board } from './board/BoardContract';
import { boardSource } from './board/boardSource';
import { createBoardStore } from './board/BoardStore';
import { IssueDetailChannel } from './detail/IssueDetailContract';
import { IssueDetailService } from './detail/IssueDetailService';
import { detailSource } from './detail/detailSource';
import { SearchIndex } from './search/SearchIndex';
import { Compose } from './compose/ComposeContract';
import { ComposeService } from './compose/ComposeService';
import { IssueQueryService } from './issues/IssueQueryService';
import { Issues } from './issues/IssuesContract';
import { issuesSource } from './issues/issuesSource';
import { IssueStore } from './model/IssueStore';
import { OverlayPersistence } from './model/persistence';
import { seedWorkspace } from './model/seed';

const SEED = 1;
const ISSUES = 50_000;
/** There is no sign-in (see the roadmap): everyone is Ada. */
const ME = 'u0';

const disk = new IndexedDbStorage({ database: 'gesso-issue-tracker' });
const store = new IssueStore(seedWorkspace({ seed: SEED, issues: ISSUES }), SEED);
const persistence = new OverlayPersistence(disk);
const preferences = new PreferencesStore(disk);
const search = new SearchIndex(store);
const detail = new IssueDetailService(store, ME);
const compose = new ComposeService(store, disk, ME);

const reset = (): void => {
  store.reset();
  void persistence.clear();
};

serveChannels([
  { token: WorkspaceMeta, source: workspaceSource(store.workspace, ME) },
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
  { token: Issues, source: issuesSource(new IssueQueryService(store, search), store, reset) },
  { token: IssueDetailChannel, source: detailSource(detail) },
  {
    token: Compose,
    source: {
      view: { draft: compose.draft, filed: compose.filed },
      commands: {
        save: draft => compose.save(draft),
        file: draft => compose.file(draft),
        discard: () => compose.discard()
      }
    }
  }
]);

void compose.restore();

void preferences.restore();

void persistence.restore(store).then(outcome => {
  if (outcome === 'rejected') {
    // Written by another seed or an older build: it cannot be laid over
    // this workspace, so start clean rather than half-apply it.
    void persistence.clear();
  }
  persistence.watch(store);
  // Built after the saved changes are in, so it indexes what's there.
  search.warm();
});

self.addEventListener('beforeunload', () => {
  void persistence.flush();
  void compose.flush();
});
