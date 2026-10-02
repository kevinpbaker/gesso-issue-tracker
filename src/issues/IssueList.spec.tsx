import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { percent, shortcuts } from 'gesso-core';
import { createComponent, ServiceRegistry, type ComponentContext, type Inputs } from 'gesso-framework';
import { renderTest, serveForTest, type Rendered, type ServedForTest } from 'gesso-testing';

import { ShortcutsService } from '../app/ShortcutsService';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import { workspaceSource } from '../app/workspaceSource';
import { IssueStore } from '../model/IssueStore';
import { DEFAULT_QUERY } from '../model/query';
import { seedWorkspace } from '../model/seed';
import { IssueList, locate, positionOf } from './IssueList';
import { IssueQueryService } from './IssueQueryService';
import { Issues, type IssuesSummary } from './IssuesContract';
import { issuesSource } from './issuesSource';

/**
 * The list from the keyboard, as Phase 3's exit criterion asks: every
 * key is pressed the way a person presses it, and what happened is read
 * back from the app worker's side (the selection, the store).
 */

function Harness(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const { registry } = ctx.inject(ShortcutsService);
  return (
    <column width={percent(100)} height={percent(100)} modifiers={[shortcuts({ registry })]}>
      <IssueList query={of({ ...DEFAULT_QUERY, group: 'none' as const })} />
    </column>
  );
}

interface Mounted {
  ui: Rendered;
  served: ServedForTest;
  store: IssueStore;
  service: IssueQueryService;
}

let h: Mounted;
afterEach(() => {
  h?.ui.unmount();
  h?.served.dispose();
});

async function mount(): Promise<void> {
  const store = new IssueStore(seedWorkspace({ issues: 400 }));
  const service = new IssueQueryService(store);
  const served = serveForTest([
    { token: Issues, source: issuesSource(service, store, () => store.reset()) },
    { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') }
  ]);
  // Registered before the runtime builds the root, as the worker's `useService` does.
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  const ui = renderTest(createComponent(Harness), {
    channels: served.registry,
    width: 1000,
    height: 600,
    services
  });
  h = { ui, served, store, service };
  await settle();
}

async function settle(): Promise<void> {
  await h.ui.settle();
  await h.served.settle();
  await h.ui.settle();
}

async function press(key: string, modifiers: { shift?: boolean; meta?: boolean; ctrl?: boolean } = {}): Promise<void> {
  h.ui.fireEvent.press(key, modifiers);
  await settle();
}

describe('the issue list from the keyboard', () => {
  it('selects with x, extends with Shift+J, and clears with Escape', async () => {
    await mount();
    await press('x');
    expect(h.service.selectedIds()).toHaveLength(1);
    await press('J', { shift: true });
    await press('J', { shift: true });
    expect(h.service.selectedIds()).toHaveLength(3);
    await press('Escape');
    expect(h.service.selectedIds()).toHaveLength(0);
  });

  it('moves with j and k before selecting', async () => {
    await mount();
    await press('j');
    await press('j');
    await press('k');
    await press('x');
    const [id] = h.service.selectedIds();
    expect(h.service.idsIn([[1, 1]])).toEqual([id]);
  });

  it('selects every issue with Mod+A, and a bulk edit of all of them is one undo', async () => {
    await mount();
    await press('a', { ctrl: true });
    expect(h.service.selectedIds()).toHaveLength(400);
    h.service.updateSelected({ priority: 2 }, 'Set priority to High on 400 issues');
    expect([...h.store.issues()].every(issue => issue.priority === 2)).toBe(true);
    h.store.undo();
    expect([...h.store.issues()].some(issue => issue.priority !== 2)).toBe(true);
  });

  it('draws the cursor and selection as states a screen reader hears', async () => {
    await mount();
    await press('x');
    expect(h.ui.getAllByRole('button', { states: ['selected'] }).length).toBeGreaterThanOrEqual(1);
  });
});

describe('display positions', () => {
  const summary: IssuesSummary = {
    total: 5,
    queryMs: 0,
    groups: [
      { key: 'a', label: 'A', start: 0, count: 2, shown: 2, collapsed: false },
      { key: 'b', label: 'B', start: 2, count: 4, shown: 0, collapsed: true },
      { key: 'c', label: 'C', start: 2, count: 3, shown: 3, collapsed: false }
    ]
  };

  it('puts a header before each group, collapsed ones included', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(p => {
      const at = locate(summary, p);
      return at === null ? null : at.kind === 'header' ? at.group.key : at.index;
    })).toEqual(['a', 0, 1, 'b', 'c', 2, 3, 4]);
  });

  it('inverts', () => {
    for (let index = 0; index < summary.total; index += 1) {
      const at = locate(summary, positionOf(summary, index));
      expect(at).toEqual({ kind: 'issue', index });
    }
  });
});
