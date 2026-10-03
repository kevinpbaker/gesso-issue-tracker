import { BehaviorSubject } from 'rxjs';

import type { IssueQuery } from '../model/query';
import type { TextStore } from '../model/persistence';
import type { SavedView } from './ViewsContract';

const KEY = 'views-v1';

/** The saved views, in the order they were made, written to disk on every change. */
export class ViewsStore {
  readonly views = new BehaviorSubject<readonly SavedView[]>([]);
  readonly saved = new BehaviorSubject<{ readonly id: string; readonly serial: number } | null>(null);
  private serial = 0;

  constructor(
    private readonly disk: TextStore,
    private readonly clock: () => number = Date.now
  ) {}

  async restore(): Promise<void> {
    const read = await this.disk.read(KEY);
    if (read.outcome !== 'ok' || read.value === null) return;
    try {
      const saved = JSON.parse(read.value) as unknown;
      if (Array.isArray(saved)) {
        this.views.next(saved.filter(isView));
      }
    } catch {
      // A record that won't parse is no record.
    }
  }

  save(name: string, query: IssueQuery): string | null {
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (trimmed === '') return null;
    const id = `v${this.clock().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    // Folding is how one list was looked at, not what the view is; and
    // the refinement becomes one of the view's own filters, so a
    // refinement made on the view later narrows it instead of replacing it.
    const { collapsed: _, refine, ...rest } = query;
    const kept: IssueQuery = refine === undefined ? rest : { ...rest, also: [...(rest.also ?? []), refine] };
    this.write([...this.views.value, { id, name: trimmed, query: kept }]);
    this.serial += 1;
    this.saved.next({ id, serial: this.serial });
    return id;
  }

  rename(id: string, name: string): void {
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (trimmed === '') return;
    this.write(this.views.value.map(view => (view.id === id ? { ...view, name: trimmed } : view)));
  }

  remove(id: string): void {
    this.write(this.views.value.filter(view => view.id !== id));
  }

  private write(views: readonly SavedView[]): void {
    this.views.next(views);
    void this.disk.write(KEY, JSON.stringify(views));
  }
}

function isView(value: unknown): value is SavedView {
  const view = value as Partial<SavedView> | null;
  return (
    typeof view === 'object' &&
    view !== null &&
    typeof view.id === 'string' &&
    typeof view.name === 'string' &&
    typeof view.query === 'object' &&
    view.query !== null &&
    typeof view.query.filter === 'object' &&
    typeof view.query.sort?.field === 'string' &&
    typeof view.query.group === 'string'
  );
}
