import { BehaviorSubject, Subject } from 'rxjs';

import type { ActivityEvent, Comment, FieldChange, Issue, Workspace } from './types';

/**
 * The workspace in memory, and the only thing that changes it.
 *
 * Every change is a transaction: a list of changes made together,
 * with a label ("Moved WEB-12 to Done"). One stream of transactions
 * drives everything that has to agree about what happened: undo and
 * redo, the activity feed, persistence, and later the fake sync.
 *
 * Plain TypeScript and RxJS, so every line runs in node.
 */

export type Change =
  | { readonly kind: 'update'; readonly id: string; readonly before: Partial<Issue>; readonly after: Partial<Issue> }
  | { readonly kind: 'create'; readonly issue: Issue }
  | { readonly kind: 'delete'; readonly issue: Issue }
  | { readonly kind: 'comment'; readonly comment: Comment }
  | { readonly kind: 'uncomment'; readonly comment: Comment };

export interface Transaction {
  readonly id: number;
  readonly label: string;
  readonly actorId: string;
  readonly at: number;
  readonly changes: readonly Change[];
}

/** What survives a reload: everything that differs from the seed. */
export interface Overlay {
  readonly version: 1;
  readonly seed: number;
  readonly issues: readonly Issue[];
  readonly deleted: readonly string[];
  readonly comments: readonly Comment[];
  readonly activity: readonly ActivityEvent[];
}

/** Fields whose change is bookkeeping rather than news, and stays out of the feed. */
const QUIET: ReadonlySet<keyof Issue> = new Set(['rank', 'updatedAt']);

export class IssueStore {
  private readonly issueMap = new Map<string, Issue>();
  /** `WEB-1042` to `i1234`. Keys never change, so this follows only creates and deletes. */
  private readonly keyMap = new Map<string, string>();
  private readonly commentMap = new Map<string, Comment[]>();
  private readonly activityMap = new Map<string, ActivityEvent[]>();
  /** IDs of issues that differ from the seed, for the overlay. */
  private readonly touched = new Set<string>();
  private readonly deletedIds = new Set<string>();
  private readonly addedComments: Comment[] = [];
  private readonly addedActivity: ActivityEvent[] = [];
  private readonly undoStack: Transaction[] = [];
  private readonly redoStack: Transaction[] = [];
  private nextTransaction = 1;
  private nextEvent = 1;

  /** Every transaction, after it is applied. */
  readonly changes = new Subject<Transaction>();
  /** Bumped on every change, including an overlay import or a reset. */
  readonly version = new BehaviorSubject(0);
  /** Everything was replaced at once, by an overlay import or a reset, with no transaction to describe it. */
  readonly reloaded = new Subject<void>();

  constructor(
    readonly workspace: Workspace,
    private readonly seedNumber = 1,
    private readonly clock: () => number = Date.now
  ) {
    this.load(workspace);
  }

  private load(workspace: Workspace): void {
    this.issueMap.clear();
    this.keyMap.clear();
    this.commentMap.clear();
    this.activityMap.clear();
    for (const issue of workspace.issues) {
      this.issueMap.set(issue.id, issue);
      this.keyMap.set(issue.key, issue.id);
    }
    for (const comment of workspace.comments) {
      this.listOf(this.commentMap, comment.issueId).push(comment);
    }
  }

  private listOf<T>(map: Map<string, T[]>, key: string): T[] {
    let list = map.get(key);
    if (list === undefined) {
      list = [];
      map.set(key, list);
    }
    return list;
  }

  // -------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------

  get(id: string): Issue | undefined {
    return this.issueMap.get(id);
  }

  /** By team-prefixed key, case-insensitively: `web-12` finds `WEB-12`. */
  byKey(key: string): Issue | undefined {
    const id = this.keyMap.get(key.toUpperCase());
    return id === undefined ? undefined : this.issueMap.get(id);
  }

  issues(): IterableIterator<Issue> {
    return this.issueMap.values();
  }

  get size(): number {
    return this.issueMap.size;
  }

  commentsOf(issueId: string): readonly Comment[] {
    return this.commentMap.get(issueId) ?? [];
  }

  activityOf(issueId: string): readonly ActivityEvent[] {
    return this.activityMap.get(issueId) ?? [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** What the next undo would undo, for a menu item or a toast. */
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  // -------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------

  /**
   * Applies one patch to several issues as one transaction: a bulk edit
   * of 500 issues is one undo. Issues the patch would not change are
   * left out, and a patch that changes nothing commits nothing.
   */
  update(ids: readonly string[], patch: Partial<Issue>, label: string, actorId = 'u0'): Transaction | null {
    const changes: Change[] = [];
    const at = this.clock();
    for (const id of ids) {
      const issue = this.issueMap.get(id);
      if (issue === undefined) {
        continue;
      }
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(patch) as [keyof Issue, unknown][]) {
        if (!sameValue(issue[field], value)) {
          before[field] = issue[field];
          after[field] = value;
        }
      }
      if (Object.keys(after).length > 0) {
        // The edit time is part of the change, so undo puts the old one back.
        before.updatedAt = issue.updatedAt;
        after.updatedAt = at;
        changes.push({ kind: 'update', id, before: before as Partial<Issue>, after: after as Partial<Issue> });
      }
    }
    return changes.length === 0 ? null : this.commit(label, changes, actorId);
  }

  create(issue: Issue, actorId = 'u0'): Transaction {
    return this.commit(`Created ${issue.key}`, [{ kind: 'create', issue }], actorId);
  }

  comment(comment: Comment): Transaction {
    return this.commit('Commented', [{ kind: 'comment', comment }], comment.authorId);
  }

  commit(label: string, changes: readonly Change[], actorId = 'u0'): Transaction {
    const transaction = this.transaction(label, changes, actorId);
    this.apply(transaction, true);
    this.undoStack.push(transaction);
    this.redoStack.length = 0;
    return transaction;
  }

  undo(): Transaction | null {
    const done = this.undoStack.pop();
    if (done === undefined) {
      return null;
    }
    const inverse = this.transaction(`Undo ${done.label}`, done.changes.map(invert).reverse(), done.actorId);
    this.apply(inverse, false);
    this.redoStack.push(done);
    return inverse;
  }

  redo(): Transaction | null {
    const undone = this.redoStack.pop();
    if (undone === undefined) {
      return null;
    }
    const again = this.transaction(undone.label, undone.changes, undone.actorId);
    this.apply(again, false);
    this.undoStack.push(undone);
    return again;
  }

  private transaction(label: string, changes: readonly Change[], actorId: string): Transaction {
    return { id: this.nextTransaction++, label, actorId, at: this.clock(), changes };
  }

  /**
   * `record` is false for undo and redo: the feed shows what people
   * did, and undoing a mistake is not news about the issue.
   */
  private apply(transaction: Transaction, record: boolean): void {
    for (const change of transaction.changes) {
      switch (change.kind) {
        case 'update': {
          const issue = this.issueMap.get(change.id);
          if (issue === undefined) {
            break;
          }
          // A change that carries its own edit time (every `update` does)
          // sets it, undo included; one that does not is stamped now when
          // it is something a person did, and left alone when it is undo.
          const stamped = 'updatedAt' in change.after || !record ? change.after : { ...change.after, updatedAt: transaction.at };
          this.issueMap.set(change.id, { ...issue, ...stamped });
          this.touched.add(change.id);
          const fields = (Object.keys(change.after) as (keyof Issue)[]).filter(field => !QUIET.has(field));
          if (record && fields.length > 0) {
            this.record(change.id, transaction, 'updated', fields.map(field => ({ field, from: change.before[field], to: change.after[field] })));
          }
          break;
        }
        case 'create':
          this.issueMap.set(change.issue.id, change.issue);
          this.keyMap.set(change.issue.key, change.issue.id);
          this.touched.add(change.issue.id);
          this.deletedIds.delete(change.issue.id);
          if (record) {
            this.record(change.issue.id, transaction, 'created', []);
          }
          break;
        case 'delete':
          this.issueMap.delete(change.issue.id);
          this.keyMap.delete(change.issue.key);
          this.touched.delete(change.issue.id);
          this.deletedIds.add(change.issue.id);
          break;
        case 'comment':
          this.listOf(this.commentMap, change.comment.issueId).push(change.comment);
          this.addedComments.push(change.comment);
          if (record) {
            this.record(change.comment.issueId, transaction, 'commented', []);
          }
          break;
        case 'uncomment': {
          const list = this.commentMap.get(change.comment.issueId) ?? [];
          removeWhere(list, comment => comment.id === change.comment.id);
          removeWhere(this.addedComments, comment => comment.id === change.comment.id);
          break;
        }
      }
    }
    this.changes.next(transaction);
    this.version.next(this.version.value + 1);
  }

  private record(issueId: string, transaction: Transaction, kind: ActivityEvent['kind'], changes: FieldChange[]): void {
    const event: ActivityEvent = {
      id: `a${this.nextEvent++}`,
      issueId,
      actorId: transaction.actorId,
      at: transaction.at,
      kind,
      changes
    };
    this.listOf(this.activityMap, issueId).push(event);
    this.addedActivity.push(event);
  }

  // -------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------

  exportOverlay(): Overlay {
    return {
      version: 1,
      seed: this.seedNumber,
      issues: [...this.touched].map(id => this.issueMap.get(id)!).filter(Boolean),
      deleted: [...this.deletedIds],
      comments: [...this.addedComments],
      activity: [...this.addedActivity]
    };
  }

  /**
   * Lays a saved overlay over the seed. Not a transaction: nothing here
   * is undoable, because nothing here was done in this session.
   * Returns false, and changes nothing, for an overlay from another
   * seed or another format.
   */
  importOverlay(overlay: unknown): boolean {
    if (!isOverlay(overlay) || overlay.seed !== this.seedNumber) {
      return false;
    }
    for (const issue of overlay.issues) {
      this.issueMap.set(issue.id, issue);
      this.keyMap.set(issue.key, issue.id);
      this.touched.add(issue.id);
    }
    for (const id of overlay.deleted) {
      const gone = this.issueMap.get(id);
      if (gone !== undefined) this.keyMap.delete(gone.key);
      this.issueMap.delete(id);
      this.deletedIds.add(id);
    }
    for (const comment of overlay.comments) {
      this.listOf(this.commentMap, comment.issueId).push(comment);
      this.addedComments.push(comment);
    }
    for (const event of overlay.activity) {
      this.listOf(this.activityMap, event.issueId).push(event);
      this.addedActivity.push(event);
      this.nextEvent = Math.max(this.nextEvent, Number(event.id.slice(1)) + 1);
    }
    this.reloaded.next();
    this.version.next(this.version.value + 1);
    return true;
  }

  /** Back to the seed, as if nothing had ever been done. */
  reset(): void {
    this.load(this.workspace);
    this.touched.clear();
    this.deletedIds.clear();
    this.addedComments.length = 0;
    this.addedActivity.length = 0;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.reloaded.next();
    this.version.next(this.version.value + 1);
  }
}

function invert(change: Change): Change {
  switch (change.kind) {
    case 'update':
      return { kind: 'update', id: change.id, before: change.after, after: change.before };
    case 'create':
      return { kind: 'delete', issue: change.issue };
    case 'delete':
      return { kind: 'create', issue: change.issue };
    case 'comment':
      return { kind: 'uncomment', comment: change.comment };
    case 'uncomment':
      return { kind: 'comment', comment: change.comment };
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

function removeWhere<T>(list: T[], predicate: (value: T) => boolean): void {
  const index = list.findIndex(predicate);
  if (index >= 0) {
    list.splice(index, 1);
  }
}

function isOverlay(value: unknown): value is Overlay {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const overlay = value as Partial<Overlay>;
  return (
    overlay.version === 1 &&
    typeof overlay.seed === 'number' &&
    Array.isArray(overlay.issues) &&
    Array.isArray(overlay.deleted) &&
    Array.isArray(overlay.comments) &&
    Array.isArray(overlay.activity)
  );
}
