import { BehaviorSubject } from 'rxjs';

import type { IssueStore } from '../model/IssueStore';
import { fuzzyScore } from '../search/fuzzy';
import type { CatalogEntry, PaletteItem } from './PaletteContract';

/** The most commands and issues an answer carries. */
const COMMANDS = 40;
const ISSUES = 8;
/** The most recent issues offered before anything is typed. */
export const RECENT = 5;

/** Ranks the palette's commands and the workspace's issues against a query. Plain RxJS: it runs in node. */
export class PaletteService {
  readonly results = new BehaviorSubject<{ readonly asked: string; readonly items: readonly PaletteItem[] }>({ asked: '', items: [] });
  private catalog: readonly CatalogEntry[] = [];
  private openIssue: string | null = null;

  /** `recent` is the keys of the issues opened lately, newest first. */
  constructor(
    private readonly store: IssueStore,
    private readonly recent: () => readonly string[] = () => []
  ) {}

  setCatalog(entries: readonly CatalogEntry[]): void {
    this.catalog = entries;
  }

  setOpenIssue(key: string | null): void {
    this.openIssue = key;
  }

  search(query: string): void {
    this.results.next({ asked: query, items: this.rank(query) });
  }

  rank(query: string): PaletteItem[] {
    const commands = this.catalog
      .map((entry, index) => ({ entry, index, score: query.trim() === '' ? 0 : fuzzyScore(query, `${entry.label} ${entry.keywords ?? ''}`) }))
      .filter(found => found.score >= 0)
      // With nothing typed, the catalog's own order; otherwise best first.
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, COMMANDS)
      .map(({ entry }): PaletteItem => ({ kind: 'command', id: entry.id, label: entry.label, group: entry.group }));
    if (query.trim() === '') {
      return [...this.recentIssues(), ...commands];
    }
    // Issues, by key or title: a scan of every issue, a few milliseconds
    // at 50,000, in this worker and off the frame.
    const best: { key: string; title: string; score: number }[] = [];
    for (const issue of this.store.issues()) {
      const score = fuzzyScore(query, `${issue.key} ${issue.title}`);
      if (score < 0) continue;
      if (best.length < ISSUES || score > best[best.length - 1]!.score) {
        best.push({ key: issue.key, title: issue.title, score });
        best.sort((a, b) => b.score - a.score);
        if (best.length > ISSUES) best.pop();
      }
    }
    const issues = best.map((found): PaletteItem => ({ kind: 'issue', id: found.key, label: `${found.key} ${found.title}`, group: 'Issues' }));
    // A key typed is an issue asked for: issues first.
    return /^[a-z]+-\d*$/i.test(query.trim()) ? [...issues, ...commands] : [...commands, ...issues];
  }

  /** The issues opened lately that still exist, besides the one open now. */
  private recentIssues(): PaletteItem[] {
    // By the store's key, so `/issue/web-3` typed into the address bar is WEB-3.
    const open = this.openIssue === null ? undefined : this.store.byKey(this.openIssue)?.key;
    const items: PaletteItem[] = [];
    for (const key of this.recent()) {
      const issue = this.store.byKey(key);
      if (issue === undefined || issue.key === open) continue;
      items.push({ kind: 'issue', id: issue.key, label: `${issue.key} ${issue.title}`, group: 'Recent' });
      if (items.length === RECENT) break;
    }
    return items;
  }
}
