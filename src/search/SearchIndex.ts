import type { IssueStore, Transaction } from '../model/IssueStore';
import type { Issue } from '../model/types';

/**
 * Full-text search over every issue's title, description and comments.
 *
 * An inverted index in the app worker: each word maps to the documents
 * that hold it, a document being one issue as it is now. A search
 * matches every word of the query as a prefix (`regre` finds
 * "regression"), and an issue has to match all of them.
 *
 * **Kept up to date by the store's transactions.** An edit or a comment
 * re-indexes that one issue under a new document number; the old
 * number is left in the postings and skipped, because removing a
 * document from every list its words are in costs more than skipping
 * it. When half the documents are stale the index is rebuilt.
 *
 * Building it takes about 300 ms for 50,000 issues, so the app worker
 * builds it in slices while it's idle (`warm`), and a search that comes
 * before it's done finishes the rest on the spot. No framework import:
 * it runs in node.
 */
export class SearchIndex {
  /** Word to the documents holding it, in the order they were indexed. */
  private postings = new Map<string, number[]>();
  /** Every word, sorted, for finding the words a prefix starts. Rebuilt when new words arrive. */
  private sorted: string[] = [];
  private sortedStale = true;
  /** Document number to issue ID. */
  private issueOf: string[] = [];
  /** Issue ID to its current document number. */
  private docOf = new Map<string, number>();
  private built = false;
  private dead = 0;
  /** A build under way in slices: the IDs of the issues left to index. */
  private pending: string[] | null = null;

  constructor(private readonly store: IssueStore) {
    store.changes.subscribe(transaction => this.apply(transaction));
    store.reloaded.subscribe(() => {
      this.built = false;
      this.pending = null;
    });
  }

  /** The IDs of issues matching every word of `text`, or null when it has no words. */
  search(text: string): ReadonlySet<string> | null {
    const words = tokenize(text);
    if (words.length === 0) {
      return null;
    }
    this.ensureBuilt();
    // The rarest word first, so every intersection after it is small.
    const lists = words.map(word => this.documentsStartingWith(word)).sort((a, b) => a.size - b.size);
    let docs = lists[0]!;
    for (const list of lists.slice(1)) {
      const next = new Set<number>();
      for (const doc of docs) {
        if (list.has(doc)) next.add(doc);
      }
      docs = next;
    }
    const ids = new Set<string>();
    for (const doc of docs) {
      const id = this.issueOf[doc]!;
      if (this.docOf.get(id) === doc) ids.add(id);
    }
    // A key is a word of its own: `web-12` finds WEB-12 even though its
    // text says nothing of the sort.
    const exact = this.store.byKey(text.trim());
    if (exact !== undefined) ids.add(exact.id);
    return ids;
  }

  /** How many words the index holds, for a spec. */
  get size(): number {
    this.ensureBuilt();
    return this.postings.size;
  }

  ensureBuilt(): void {
    if (this.built) return;
    if (this.pending === null) this.start();
    for (const id of this.pending!) this.indexPending(id);
    this.finish();
  }

  /**
   * Builds the index a slice at a time, yielding between slices, so the
   * worker stays free to answer the screen while it does.
   */
  warm(slice = 2_000, schedule: (next: () => void) => void = next => setTimeout(next, 0)): void {
    if (this.built || this.pending !== null) return;
    this.start();
    const step = (): void => {
      // A search may have finished the build, or a reload restarted it.
      if (this.pending === null || this.built) return;
      for (const id of this.pending.splice(0, slice)) this.indexPending(id);
      if (this.pending.length === 0) this.finish();
      else schedule(step);
    };
    schedule(step);
  }

  private start(): void {
    this.postings = new Map();
    this.issueOf = [];
    this.docOf = new Map();
    this.dead = 0;
    this.pending = [...this.store.issues()].map(issue => issue.id);
  }

  /**
   * An issue whose turn has come, as it is now: one an edit already
   * indexed mid-build is skipped, and one deleted since is gone.
   */
  private indexPending(id: string): void {
    const issue = this.store.get(id);
    if (issue !== undefined && !this.docOf.has(id)) this.index(issue);
  }

  private finish(): void {
    this.pending = null;
    this.sortedStale = true;
    this.built = true;
  }

  private apply(transaction: Transaction): void {
    // Mid-build, the issues still to index are read when their turn comes.
    if (!this.built && this.pending === null) return;
    const touched = new Set<string>();
    for (const change of transaction.changes) {
      switch (change.kind) {
        case 'update':
          touched.add(change.id);
          break;
        case 'create':
        case 'delete':
          touched.add(change.issue.id);
          break;
        case 'comment':
        case 'uncomment':
          touched.add(change.comment.issueId);
          break;
        default:
          break;
      }
    }
    for (const id of touched) {
      if (this.docOf.has(id)) {
        this.docOf.delete(id);
        this.dead += 1;
      }
      const issue = this.store.get(id);
      if (issue !== undefined) this.index(issue);
    }
    if (this.dead > this.docOf.size) {
      this.built = false;
    }
  }

  private index(issue: Issue): void {
    const doc = this.issueOf.length;
    this.issueOf.push(issue.id);
    this.docOf.set(issue.id, doc);
    const words = new Set(tokenize(this.textOf(issue)));
    for (const word of words) {
      let list = this.postings.get(word);
      if (list === undefined) {
        list = [];
        this.postings.set(word, list);
        this.sortedStale = true;
      }
      list.push(doc);
    }
  }

  private textOf(issue: Issue): string {
    const comments = this.store.commentsOf(issue.id).map(comment => comment.body);
    return [issue.key, issue.title, issue.description, ...comments].join(' ');
  }

  /** Every document holding a word that starts with `prefix`. */
  private documentsStartingWith(prefix: string): Set<number> {
    if (this.sortedStale) {
      this.sorted = [...this.postings.keys()].sort();
      this.sortedStale = false;
    }
    const docs = new Set<number>();
    for (let at = lowerBound(this.sorted, prefix); at < this.sorted.length && this.sorted[at]!.startsWith(prefix); at++) {
      for (const doc of this.postings.get(this.sorted[at]!)!) docs.add(doc);
    }
    return docs;
  }
}

/** The words of a text: lower-cased, accents dropped, split on anything that isn't a letter or a digit. */
export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** The first index whose entry is not below `value`. */
function lowerBound(sorted: readonly string[], value: string): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}
