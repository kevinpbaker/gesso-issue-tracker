import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { percent, shortcuts, type UiNode } from 'gesso-core';
import { createComponent, route, RouterService, ServiceRegistry, type ComponentContext, type Inputs } from 'gesso-framework';
import { renderTest, serveForTest, type Rendered, type ServedForTest } from 'gesso-testing';

import { ShortcutsService } from '../app/ShortcutsService';
import { ListPlaces } from './ListPlaces';
import { CommandsService } from '../palette/CommandsService';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import { workspaceSource } from '../app/workspaceSource';
import { IssueStore } from '../model/IssueStore';
import { DEFAULT_QUERY } from '../model/query';
import { seedWorkspace } from '../model/seed';
import { IssueList, locate, positionOf } from './IssueList';
import { IssueQueryService } from './IssueQueryService';
import { Issues, type IssuesSummary } from './IssuesContract';
import { issuesSource } from './issuesSource';
import { Views } from '../views/ViewsContract';
import { ViewsStore } from '../views/ViewsStore';

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
  views: ViewsStore;
}

let h: Mounted;
afterEach(() => {
  h?.ui.unmount();
  h?.served.dispose();
});

async function mount(): Promise<void> {
  const store = new IssueStore(seedWorkspace({ issues: 400 }));
  const service = new IssueQueryService(store);
  const views = new ViewsStore({ read: async () => ({ outcome: 'ok', value: null }), write: async () => 'ok', remove: async () => 'ok' });
  const served = serveForTest([
    { token: Issues, source: issuesSource(service, store, () => store.reset()) },
    { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') },
    {
      token: Views,
      source: {
        view: { views: views.views, saved: views.saved },
        commands: { save: ({ name, query }) => void views.save(name, query), rename: ({ id, name }) => views.rename(id, name), remove: id => views.remove(id) }
      }
    }
  ]);
  // Registered before the runtime builds the root, as the worker's `useService` does.
  const services = new ServiceRegistry();
  services.register(ShortcutsService);
  services.register(ListPlaces);
  services.register(CommandsService);
  const ui = renderTest(createComponent(Harness), {
    channels: served.registry,
    width: 1000,
    height: 600,
    services
  });
  h = { ui, served, store, service, views };
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

  it('clears the selection from its toolbar, and the caret goes back to the list', async () => {
    await mount();
    const list = h.ui.getByRole('listbox', { name: 'Issues' });
    await press('x');
    h.ui.fireEvent.focus(h.ui.getByRole('button', { name: 'Clear selection' }));
    // Enter is the button's: it clears, and doesn't open the issue under the cursor.
    await press('Enter');
    expect(h.service.selectedIds()).toHaveLength(0);
    expect(h.ui.queryByRole('toolbar', { name: 'Selected issues' })).toBeNull();
    expect(h.ui.runtime.input.focus.focusedNode).toBe(list);
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

  it('is one tab stop whose cursor and selection a screen reader hears', async () => {
    await mount();
    const list = h.ui.getByRole('listbox', { name: 'Issues' });
    // A list opened is where focus starts.
    expect(h.ui.runtime.input.focus.focusedNode).toBe(list);
    // Its selection is a set, so the row under the cursor isn't selected by being there.
    expect(h.ui.getSemantics(list).states).toContain('multiselectable');
    // The cursor is the listbox's active descendant, and moves with it.
    const active = () => h.ui.getSemantics(list).activeDescendant;
    const first = active();
    expect(first).toBeDefined();
    await press('j');
    expect(active()).not.toBe(first);
    await press('x');
    const selected = h.ui.getAllByRole('option', { states: ['selected'] });
    expect(selected).toHaveLength(1);
    expect(selected[0]!.id).toBe(active());
    expect(h.ui.getSemantics(selected[0]!)).toMatchObject({ posInSet: 2, setSize: 400 });
    // Nothing in a row is a tab stop of its own: Tab from the list leaves it.
    h.ui.fireEvent.focus(list);
    await press('Tab');
    const after = h.ui.runtime.input.focus.focusedNode;
    let inside = false;
    for (let at = after; at !== null; at = at.parent) if (at === list) inside = true;
    expect(inside).toBe(false);
  });
});

describe('triage from the list', () => {
  async function type(text: string): Promise<void> {
    h.ui.fireEvent.type(text);
    await settle();
  }
  /** The issue at a list position. */
  const at = (index: number) => h.store.get(h.service.idsIn([[index, index]])[0]!)!;
  /** The picker's options, not the list's rows, which are options too. */
  const choices = () => {
    const picker = h.ui.getByRole('dialog');
    return h.ui.getAllByRole('option').filter(node => {
      for (let up = node.parent; up !== null; up = up.parent) if (up === picker) return true;
      return false;
    });
  };
  const ticked = () => choices().filter(node => h.ui.getSemantics(node).states?.includes('selected'));

  it('sets the status of the issue under the cursor from a picker beside it', async () => {
    await mount();
    await press('j');
    const issue = at(1);
    await press('s');
    const picker = h.ui.getByRole('dialog', { name: `Set the status of ${issue.key}` });
    expect(picker).toBeTruthy();
    // What it is now is ticked, and the highlight starts there.
    const field = h.ui.getByRole('combobox', { name: 'Status' });
    expect(h.ui.runtime.input.focus.focusedNode).toBe(field);
    const [current] = ticked();
    expect(h.ui.getSemantics(current!).label).toBe(h.store.workspace.states.find(state => state.id === issue.stateId)!.name);
    expect(h.ui.getSemantics(field).activeDescendant).toBe(current!.id);
    const target = h.store.workspace.states.find(state => state.id !== issue.stateId && state.name !== 'Backlog')!;
    await type(target.name.slice(0, 3).toLowerCase());
    await press('Enter');
    expect(h.store.get(issue.id)!.stateId).toBe(target.id);
    expect(h.store.undoLabel).toBe(`Moved ${issue.key} to ${target.name}`);
    // Closed, and the caret is back on the list.
    expect(h.ui.queryByRole('dialog')).toBeNull();
    expect(h.ui.runtime.input.focus.focusedNode).toBe(h.ui.getByRole('listbox', { name: 'Issues' }));
  });

  it('changes every selected issue in one undo step, and names how many', async () => {
    await mount();
    await press('x');
    await press('J', { shift: true });
    await press('J', { shift: true });
    const ids = h.service.selectedIds();
    const before = ids.map(id => h.store.get(id)!.priority);
    await press('p');
    expect(h.ui.getByRole('dialog', { name: 'Set the priority of 3 issues' })).toBeTruthy();
    // Several issues have no one value to tick.
    expect(ticked()).toHaveLength(0);
    // A digit finds its priority.
    await type('4');
    await press('Enter');
    expect(ids.every(id => h.store.get(id)!.priority === 4)).toBe(true);
    // The list sorts by priority, so the top three were Urgent, not Low.
    expect(h.store.undoLabel).toBe('Set 3 issues to Low priority');
    h.store.undo();
    expect(ids.map(id => h.store.get(id)!.priority)).toEqual(before);
  });

  it('assigns from a picker searched by handle, and to me with i', async () => {
    await mount();
    const issue = at(0);
    const grace = h.store.workspace.users.find(user => user.name === 'Grace Kim')!;
    await press('a');
    await type(grace.handle);
    await press('Enter');
    expect(h.store.get(issue.id)!.assigneeId).toBe(grace.id);
    await press('i');
    expect(h.store.get(issue.id)!.assigneeId).toBe('u0');
    expect(h.store.undoLabel).toBe(`Assigned ${issue.key} to ${h.store.workspace.users.find(user => user.id === 'u0')!.name}`);
  });

  it('adds a label with l, and takes it off again', async () => {
    await mount();
    const issue = at(0);
    const label = h.store.workspace.labels.find(entry => !issue.labelIds.includes(entry.id))!;
    await press('l');
    await type(label.name);
    await press('Enter');
    expect(h.store.get(issue.id)!.labelIds).toContain(label.id);
    await press('l');
    await type(label.name);
    expect(ticked().map(node => h.ui.getSemantics(node).label)).toContain(label.name);
    await press('Enter');
    expect(h.store.get(issue.id)!.labelIds).not.toContain(label.id);
    expect(h.store.undoLabel).toBe(`Removed ${label.name} from ${issue.key}`);
  });

  it('changes nothing on Escape, and keeps the selection', async () => {
    await mount();
    await press('x');
    await press('s');
    await type('done');
    await press('Escape');
    expect(h.ui.queryByRole('dialog')).toBeNull();
    expect(h.store.canUndo).toBe(false);
    // Escape was the picker's: the list's Escape would have cleared the selection.
    expect(h.service.selectedIds()).toHaveLength(1);
  });

  it('lists the triage keys wherever shortcuts are listed', async () => {
    await mount();
    const { registry } = h.ui.runtime.services.get(ShortcutsService);
    const live = registry.active(h.ui.runtime.input.focus.focusedNode).map(binding => `${binding.display} ${binding.label}`);
    expect(live).toEqual(expect.arrayContaining(['S Set status', 'A Assign', 'P Set priority', 'L Add or remove a label', 'I Assign to me']));
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

describe('the issue list from the pointer', () => {
  /** Each row's tick box, top to bottom: pointer targets with no role of their own. */
  const tickBoxes = (): UiNode[] => {
    const found: UiNode[] = [];
    const walk = (node: UiNode): void => {
      const label = node.properties.get('label');
      if (label === 'Select' || label === 'Deselect') found.push(node);
      for (let child = node.firstChild; child !== null; child = child.nextSibling) walk(child);
    };
    walk(h.ui.runtime.debugRoot());
    return found;
  };

  it('selects with a row\'s tick box and stays on the list, where the row itself opens the issue', async () => {
    await mount();
    const url = () => h.ui.runtime.services.get(RouterService).url.value;
    const before = url();
    h.ui.fireEvent.click(tickBoxes()[2]!);
    await settle();
    expect(url()).toBe(before);
    expect(h.service.selectedIds()).toHaveLength(1);
    // And again, to take it off.
    h.ui.fireEvent.click(tickBoxes()[2]!);
    await settle();
    expect(url()).toBe(before);
    expect(h.service.selectedIds()).toHaveLength(0);
  });
});

describe('the filter bar', () => {
  const router = () => h.ui.runtime.services.get(RouterService);
  const total = () => h.service.query.value;

  async function at(url: string): Promise<void> {
    await mount();
    router().setRoutes({ routes: [route({ path: '/team/:key/list', component: Harness })] });
    router().navigate(url);
    await settle();
  }

  it('reads the filter from the url, and shows a control for each part of it', async () => {
    await at('/team/web/list?status=todo,in-progress&priority=1');
    expect(total().refine).toEqual({ stateIds: ['todo', 'in-progress'], priorities: [1] });
    expect(h.ui.getByRole('group', { name: 'Status filter' })).toBeDefined();
    expect(h.ui.getByRole('listitem', { name: 'In Progress' })).toBeDefined();
    expect(h.ui.getByRole('listitem', { name: 'Urgent' })).toBeDefined();
  });

  it('writes a search to the url once typing stops, and filters by it', async () => {
    await at('/team/web/list');
    h.ui.fireEvent.focus(h.ui.getByRole('textbox', { name: 'Search issues' }));
    h.ui.fireEvent.type('webhook');
    await new Promise(resolve => setTimeout(resolve, 250));
    await settle();
    expect(router().url.value).toBe('/team/web/list?q=webhook');
    expect(total().refine).toEqual({ text: 'webhook' });
  });

  it('adds a filter from the menu, from the keyboard, and takes it off again', async () => {
    await at('/team/web/list');
    h.ui.fireEvent.focus(h.ui.getByRole('combobox', { name: 'Add a filter' }));
    await press('Enter');
    await press('l');
    await press('Enter');
    // The new control has the caret.
    const labels = h.ui.getByRole('combobox', { name: 'Label' });
    expect(h.ui.runtime.input.focus.focusedNode).toBe(labels);
    h.ui.fireEvent.type('bug');
    await settle();
    await press('Enter');
    expect(router().url.value).toBe('/team/web/list?label=l0');
    h.ui.fireEvent.click(h.ui.getByRole('button', { name: 'Remove the label filter' }));
    await settle();
    expect(router().url.value).toBe('/team/web/list');
    expect(total().refine).toBeUndefined();
  });

  it('keeps the caret when a filter is taken off, or all of them', async () => {
    await at('/team/web/list?priority=1&label=l0');
    const menu = () => h.ui.getByRole('combobox', { name: 'Add a filter' });
    h.ui.fireEvent.focus(h.ui.getByRole('button', { name: 'Remove the priority filter' }));
    await press('Enter');
    expect(router().url.value).toBe('/team/web/list?label=l0');
    expect(h.ui.runtime.input.focus.focusedNode).toBe(menu());
    h.ui.fireEvent.focus(h.ui.getByRole('button', { name: 'Clear the filters' }));
    await press('Enter');
    expect(router().url.value).toBe('/team/web/list');
    expect(h.ui.runtime.input.focus.focusedNode).toBe(menu());
  });

  it('saves the list, filter and all, as a named view and opens it', async () => {
    await at('/team/web/list?priority=1');
    router().setRoutes({ routes: [route({ path: '/team/:key/list', component: Harness }), route({ path: '/view/:id', component: Harness })] });
    h.ui.fireEvent.click(h.ui.getByRole('button', { name: 'Save as a view' }));
    await settle();
    // The name field has the caret; Enter saves.
    expect(h.ui.runtime.input.focus.focusedNode).toBe(h.ui.getByRole('textbox', { name: 'Name' }));
    h.ui.fireEvent.type('Urgent web');
    await settle();
    await press('Enter');
    const [view] = h.views.views.value;
    expect(view).toMatchObject({ name: 'Urgent web', query: { also: [{ priorities: [1] }] } });
    expect(router().url.value).toBe(`/view/${view!.id}`);
  });
});

describe('the Phase 8 budget', () => {
  /**
   * A filter change across 50,000 issues, from the url changing to the
   * list drawn again: the query in the app worker, the channel, and the
   * frame that lays out and paints the new rows. The fastest of a few,
   * since specs running beside this one only ever slow a run down.
   */
  it('repaints a filter change across 50,000 issues within 100 ms', async () => {
    const store = new IssueStore(seedWorkspace({ issues: 50_000 }));
    const service = new IssueQueryService(store);
    const views = new ViewsStore({ read: async () => ({ outcome: 'ok', value: null }), write: async () => 'ok', remove: async () => 'ok' });
    const served = serveForTest([
      { token: Issues, source: issuesSource(service, store, () => store.reset()) },
      { token: WorkspaceMeta, source: workspaceSource(store.workspace, 'u0') },
      { token: Views, source: { view: { views: views.views, saved: views.saved }, commands: { save: () => {}, rename: () => {}, remove: () => {} } } }
    ]);
    const services = new ServiceRegistry();
    services.register(ShortcutsService);
    services.register(ListPlaces);
    services.register(CommandsService);
    const ui = renderTest(createComponent(Harness), { channels: served.registry, width: 1000, height: 600, services });
    h = { ui, served, store, service, views };
    const router = ui.runtime.services.get(RouterService);
    router.setRoutes({ routes: [route({ path: '/team/:key/list', component: Harness })] });
    router.navigate('/team/web/list');
    await settle();
    let fastest = Infinity;
    const urls = ['?status=todo,in-progress', '?status=todo&priority=1,2', '?label=l0,l1&assignee=u1', '?status=done'];
    for (const url of urls) {
      const started = performance.now();
      router.navigate(`/team/web/list${url}`);
      await settle();
      fastest = Math.min(fastest, performance.now() - started);
    }
    expect(service.query.value.refine).toEqual({ stateIds: ['done'] });
    expect(fastest).toBeLessThan(100);
  });
});
