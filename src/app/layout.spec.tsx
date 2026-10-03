import { expect, it } from 'vitest';
import { percent } from 'gesso-core';
import { SplitPane } from 'gesso-components';
import { createComponent, ServiceRegistry, type ComponentContext, type Inputs } from 'gesso-framework';
import { renderTest, serveForTest } from 'gesso-testing';

import { ShortcutsService } from './ShortcutsService';
import { WorkspaceMeta } from './WorkspaceContract';
import { workspaceSource } from './workspaceSource';
import { Board } from '../board/BoardContract';
import { BoardScreen } from '../board/BoardScreen';
import { boardSource } from '../board/boardSource';
import { createBoardStore } from '../board/BoardStore';
import { IssueQueryService } from '../issues/IssueQueryService';
import { Issues } from '../issues/IssuesContract';
import { issuesSource } from '../issues/issuesSource';
import { IssueStore } from '../model/IssueStore';
import { seedWorkspace } from '../model/seed';

function Repro(_i: Inputs<{}>, _c: ComponentContext) {
  const main = (
    <column flexGrow={1} minWidth={0} width={percent(100)} height={percent(100)} x="stretch" label="main">
      <row height={48} x="space-between" label="bar">
        <text text="Title" />
        <text text="Undo" />
      </row>
      <box flexGrow={1} minWidth={0} x="stretch" y="stretch">
        <BoardScreen />
      </box>
    </column>
  );
  return (
    <row width={percent(100)} height={percent(100)} y="stretch">
      <SplitPane flexGrow={1} label="Sidebar" split={0.2} first={<column label="side" />} second={main} />
    </row>
  );
}

/**
 * A board is wider than its pane, and the pane must not grow to fit it:
 * the board scrolls inside the pane instead. This is the shape of the
 * real shell (a SplitPane whose second pane is the main column), with
 * the real BoardScreen in it.
 */
it('keeps a five-column board inside its pane', async () => {
  const store = new IssueStore(seedWorkspace({ issues: 200 }));
  const served = serveForTest([
    { token: Board, source: boardSource(createBoardStore(store)) },
    // The board's triage keys go through these.
    { token: Issues, source: issuesSource(new IssueQueryService(store), store, () => store.reset()) },
    { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') }
  ]);
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  const ui = renderTest(createComponent(Repro), { channels: served.registry, width: 600, height: 400, services });
  await ui.settle();
  await served.settle();
  await ui.settle();
  const main = ui.getLayout(ui.getByLabel('main'));
  const board = ui.getLayout(ui.getByLabel('Board'));
  expect(main.x + main.width).toBeLessThanOrEqual(600);
  expect(board.width).toBe(main.width);
  ui.unmount();
  served.dispose();
});
