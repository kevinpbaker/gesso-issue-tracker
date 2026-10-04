import { BehaviorSubject } from 'rxjs';

import type { IssueStore } from '../model/IssueStore';
import type { Issue } from '../model/types';
import { fuzzyScore } from '../search/fuzzy';
import { askedFor, type IssueReference } from './ReferencesContract';

/** The most issues an answer carries: what the editor's list shows. */
export const FOUND = 8;

/** Matches a team's issues against what's typed after its key. Plain RxJS: it runs in node. */
export class ReferenceService {
  readonly found = new BehaviorSubject<{ readonly asked: string; readonly issues: readonly IssueReference[] }>({ asked: '', issues: [] });

  constructor(private readonly store: IssueStore) {}

  find(prefix: string, query: string): void {
    this.found.next({ asked: askedFor(prefix, query), issues: this.match(prefix, query) });
  }

  /**
   * The team's issues for a query: by number when it's digits, the
   * keys that start with them, shortest first, so `WEB-12` comes before
   * `WEB-120`; by title when it's words; the latest touched when it's
   * nothing.
   */
  match(prefix: string, query: string): IssueReference[] {
    const team = this.store.workspace.teams.find(t => t.key === prefix);
    if (team === undefined) {
      return [];
    }
    const text = query.trim();
    if (/^\d+$/.test(text)) {
      return this.byNumber(team.key, text, this.store.lastNumberOf(team.id));
    }
    // A scan of every issue, a few milliseconds at 50,000, in this
    // worker and off the frame: the palette's search does the same.
    const best: { issue: Issue; score: number }[] = [];
    for (const issue of this.store.issues()) {
      if (issue.teamId !== team.id) continue;
      const score = text === '' ? issue.updatedAt : fuzzyScore(text, issue.title);
      if (score < 0) continue;
      if (best.length < FOUND || score > best[best.length - 1]!.score) {
        best.push({ issue, score });
        best.sort((a, b) => b.score - a.score);
        if (best.length > FOUND) best.pop();
      }
    }
    return best.map(({ issue }) => ({ key: issue.key, title: issue.title }));
  }

  /**
   * Looked up key by key, `12`, then `120` to `129`, then `1200` to
   * `1299`, up to the team's last number: no scan, and in order.
   */
  private byNumber(key: string, digits: string, last: number): IssueReference[] {
    const out: IssueReference[] = [];
    if (digits.startsWith('0')) {
      return out;
    }
    for (let first = Number(digits), span = 1; first <= last && out.length < FOUND; first *= 10, span *= 10) {
      for (let n = first; n < first + span && n <= last && out.length < FOUND; n++) {
        const issue = this.store.byKey(`${key}-${n}`);
        if (issue !== undefined) out.push({ key: issue.key, title: issue.title });
      }
    }
    return out;
  }
}
