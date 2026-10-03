import { BehaviorSubject, Subject } from 'rxjs';

import type { ActivityEvent, Comment, FieldChange, Issue, IssueRelation, Workspace } from './types';

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
  | { readonly kind: 'uncomment'; readonly comment: Comment }
  | { readonly kind: 'relate'; readonly relation: IssueRelation }
  | { readonly kind: 'unrelate'; readonly relation: IssueRelation };

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
  /** Links made since the seed. Absent from an overlay saved before there were links. */
  readonly relations?: readonly IssueRelation[];
  /** Seed links taken away, by id. */
  readonly unrelated?: readonly string[];
}

/**
 * How long a run of edits to the same text by the same person stays one
 * line in the feed. A description saves a moment after each pause in
 * typing, and ten saves in a minute are one edit to whoever reads it.
 */
const RUN_MS = 10 * 60_000;
const RUNS: ReadonlySet<keyof Issue> = new Set(['description']);

/** Fields whose change is bookkeeping rather than news, and stays out of the feed. */
const QUIET: ReadonlySet<keyof Issue> = new Set(['rank', 'updatedAt']);

export class IssueStore {
  private readonly issueMap = new Map<string, Issue>();
  /** `WEB-1042` to `i1234`. Keys never change, so this follows only creates and deletes. */
  private readonly keyMap = new Map<string, string>();
  private readonly commentMap = new Map<string, Comment[]>();
  private readonly activityMap = new Map<string, ActivityEvent[]>();
  /** Every link an issue is at either end of. */
  private readonly relationMap = new Map<string, IssueRelation[]>();
  /** A parent's sub-issues, by id, in the order they were made. */
  private readonly childMap = new Map<string, string[]>();
  private readonly addedRelations: IssueRelation[] = [];
  private readonly removedRelations = new Set<string>();
  /** The highest number used in each team's keys, so a new issue takes the next. */
  private readonly lastNumber = new Map<string, number>();
  /** The smallest rank in each state, so a new issue goes to the top. */
  private readonly topRank = new Map<string, number>();
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
    this.relationMap.clear();
    this.childMap.clear();
    this.lastNumber.clear();
    this.topRank.clear();
    for (const issue of workspace.issues) {
      this.issueMap.set(issue.id, issue);
      this.keyMap.set(issue.key, issue.id);
      this.count(issue);
      if (issue.parentId !== null) {
        this.listOf(this.childMap, issue.parentId).push(issue.id);
      }
    }
    for (const comment of workspace.comments) {
      this.listOf(this.commentMap, comment.issueId).push(comment);
    }
    for (const relation of workspace.relations) {
      this.link(relation);
    }
  }

  /** Notes an issue's key number and rank, for the next issue made. */
  private count(issue: Issue): void {
    const number = Number(issue.key.slice(issue.key.lastIndexOf('-') + 1));
    if (number > (this.lastNumber.get(issue.teamId) ?? 0)) {
      this.lastNumber.set(issue.teamId, number);
    }
    if (issue.rank < (this.topRank.get(issue.stateId) ?? Infinity)) {
      this.topRank.set(issue.stateId, issue.rank);
    }
  }

  private link(relation: IssueRelation): void {
    this.listOf(this.relationMap, relation.fromId).push(relation);
    if (relation.toId !== relation.fromId) {
      this.listOf(this.relationMap, relation.toId).push(relation);
    }
  }

  private unlink(relation: IssueRelation): void {
    for (const end of [relation.fromId, relation.toId]) {
      removeWhere(this.relationMap.get(end) ?? [], entry => entry.id === relation.id);
    }
  }

  /** Moves an issue between parents' lists of sub-issues. */
  private reparent(id: string, from: string | null | undefined, to: string | null | undefined): void {
    if (from === to) {
      return;
    }
    if (from != null) {
      removeWhere(this.childMap.get(from) ?? [], child => child === id);
    }
    if (to != null) {
      this.listOf(this.childMap, to).push(id);
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

  /** The links an issue is at either end of. */
  relationsOf(issueId: string): readonly IssueRelation[] {
    return this.relationMap.get(issueId) ?? [];
  }

  /** An issue's sub-issues. */
  childrenOf(issueId: string): readonly Issue[] {
    return (this.childMap.get(issueId) ?? []).flatMap(id => this.issueMap.get(id) ?? []);
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

  /**
   * A new issue, numbered after the team's last and ranked first in its
   * state, ready for `create`. A number isn't reused once taken, even if
   * the issue it went to is undone: a key someone saw keeps meaning that
   * issue.
   */
  newIssue(fields: Pick<Issue, 'teamId' | 'title' | 'description' | 'stateId' | 'priority' | 'assigneeId' | 'labelIds'> & Partial<Issue>): Issue {
    const team = this.workspace.teams.find(entry => entry.id === fields.teamId);
    if (team === undefined) {
      throw new Error(`No team '${fields.teamId}'.`);
    }
    const number = (this.lastNumber.get(team.id) ?? 0) + 1;
    this.lastNumber.set(team.id, number);
    const at = this.clock();
    return {
      projectId: null,
      estimate: null,
      dueDate: null,
      parentId: null,
      ...fields,
      id: `n-${team.id}-${number}`,
      key: `${team.key}-${number}`,
      rank: (this.topRank.get(fields.stateId) ?? 1024) - 1024,
      createdAt: at,
      updatedAt: at
    };
  }

  create(issue: Issue, actorId = 'u0'): Transaction {
    return this.commit(`Created ${issue.key}`, [{ kind: 'create', issue }], actorId);
  }

  comment(comment: Comment): Transaction {
    return this.commit('Commented', [{ kind: 'comment', comment }], comment.authorId);
  }

  /** Links two issues. Linking two that are already linked the same way commits nothing. */
  relate(relation: IssueRelation, actorId = 'u0'): Transaction | null {
    const exists = this.relationsOf(relation.fromId).some(
      entry =>
        entry.kind === relation.kind &&
        ((entry.fromId === relation.fromId && entry.toId === relation.toId) ||
          (relation.kind === 'related' && entry.fromId === relation.toId && entry.toId === relation.fromId))
    );
    if (exists || relation.fromId === relation.toId) {
      return null;
    }
    return this.commit('Linked issues', [{ kind: 'relate', relation }], actorId);
  }

  unrelate(relationId: string, issueId: string, actorId = 'u0'): Transaction | null {
    const relation = this.relationsOf(issueId).find(entry => entry.id === relationId);
    return relation === undefined ? null : this.commit('Unlinked issues', [{ kind: 'unrelate', relation }], actorId);
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
          if ('parentId' in change.after) {
            this.reparent(change.id, issue.parentId, change.after.parentId);
          }
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
          this.count(change.issue);
          this.reparent(change.issue.id, null, change.issue.parentId);
          this.touched.add(change.issue.id);
          this.deletedIds.delete(change.issue.id);
          if (record) {
            this.record(change.issue.id, transaction, 'created', []);
          }
          break;
        case 'delete':
          this.issueMap.delete(change.issue.id);
          this.keyMap.delete(change.issue.key);
          this.reparent(change.issue.id, change.issue.parentId, null);
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
        case 'relate':
          this.link(change.relation);
          if (!this.removedRelations.delete(change.relation.id)) {
            this.addedRelations.push(change.relation);
          }
          if (record) {
            for (const end of [change.relation.fromId, change.relation.toId]) {
              this.record(end, transaction, 'related', [], change.relation);
            }
          }
          break;
        case 'unrelate': {
          this.unlink(change.relation);
          const added = this.addedRelations.findIndex(entry => entry.id === change.relation.id);
          if (added >= 0) {
            this.addedRelations.splice(added, 1);
          } else {
            this.removedRelations.add(change.relation.id);
          }
          if (record) {
            for (const end of [change.relation.fromId, change.relation.toId]) {
              this.record(end, transaction, 'unrelated', [], change.relation);
            }
          }
          break;
        }
      }
    }
    this.changes.next(transaction);
    this.version.next(this.version.value + 1);
  }

  private record(
    issueId: string,
    transaction: Transaction,
    kind: ActivityEvent['kind'],
    changes: FieldChange[],
    relation?: IssueRelation
  ): void {
    const last = this.activityMap.get(issueId)?.at(-1);
    if (
      kind === 'updated' &&
      last !== undefined &&
      last.kind === 'updated' &&
      last.actorId === transaction.actorId &&
      transaction.at - last.at < RUN_MS &&
      changes.length === 1 &&
      RUNS.has(changes[0]!.field) &&
      last.changes.length === 1 &&
      last.changes[0]!.field === changes[0]!.field
    ) {
      // The same run: one line, from where it started to where it is now.
      const merged: ActivityEvent = { ...last, at: transaction.at, changes: [{ ...changes[0]!, from: last.changes[0]!.from }] };
      this.activityMap.get(issueId)!.splice(-1, 1, merged);
      const saved = this.addedActivity.lastIndexOf(last);
      if (saved >= 0) this.addedActivity.splice(saved, 1, merged);
      return;
    }
    const event: ActivityEvent = {
      id: `a${this.nextEvent++}`,
      issueId,
      actorId: transaction.actorId,
      at: transaction.at,
      kind,
      changes,
      ...(relation === undefined ? {} : { relation })
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
      activity: [...this.addedActivity],
      relations: [...this.addedRelations],
      unrelated: [...this.removedRelations]
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
    for (const saved of overlay.issues) {
      const issue = withNewFields(saved);
      this.reparent(issue.id, this.issueMap.get(issue.id)?.parentId, issue.parentId);
      this.issueMap.set(issue.id, issue);
      this.keyMap.set(issue.key, issue.id);
      this.count(issue);
      this.touched.add(issue.id);
    }
    for (const id of overlay.deleted) {
      const gone = this.issueMap.get(id);
      if (gone !== undefined) {
        this.keyMap.delete(gone.key);
        this.reparent(id, gone.parentId, null);
      }
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
    for (const id of overlay.unrelated ?? []) {
      const relation = this.workspace.relations.find(entry => entry.id === id);
      if (relation !== undefined) {
        this.unlink(relation);
        this.removedRelations.add(id);
      }
    }
    for (const relation of overlay.relations ?? []) {
      this.link(relation);
      this.addedRelations.push(relation);
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
    this.addedRelations.length = 0;
    this.removedRelations.clear();
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
    case 'relate':
      return { kind: 'unrelate', relation: change.relation };
    case 'unrelate':
      return { kind: 'relate', relation: change.relation };
  }
}

/** An issue saved before estimates, due dates and sub-issues existed, with them empty. */
function withNewFields(issue: Issue): Issue {
  return {
    ...issue,
    estimate: issue.estimate ?? null,
    dueDate: issue.dueDate ?? null,
    parentId: issue.parentId ?? null
  };
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
