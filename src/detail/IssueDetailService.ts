import { BehaviorSubject, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';

import type { IssueStore } from '../model/IssueStore';
import { PRIORITY_NAMES, type ActivityEvent, type FieldChange, type Issue, type IssueRelation, type Priority } from '../model/types';
import type { IssueDetail, IssueRef, LinkKind, LinkRow } from './IssueDetailContract';

/** How many issues a search answers with. */
const FOUND = 8;

/** One open issue, re-read from the store on every change. Plain RxJS, so it runs in node. */
export class IssueDetailService {
  private readonly asked = new BehaviorSubject<string | null>(null);
  readonly detail;
  /** What the last search matched. */
  readonly found = new BehaviorSubject<readonly IssueRef[]>([]);
  private readonly closedStates: ReadonlySet<string>;

  private readonly names;

  constructor(
    private readonly store: IssueStore,
    private readonly me = 'u0',
    private readonly clock: () => number = Date.now
  ) {
    const { workspace } = store;
    const byId = <T extends { id: string; name: string }>(list: readonly T[]) => new Map(list.map(item => [item.id, item.name]));
    this.names = {
      teams: byId(workspace.teams),
      states: byId(workspace.states),
      users: byId(workspace.users),
      labels: byId(workspace.labels),
      projects: byId(workspace.projects)
    };
    this.closedStates = new Set(workspace.states.filter(state => state.type === 'completed' || state.type === 'canceled').map(state => state.id));

    this.detail = combineLatest([this.asked, store.version]).pipe(
      map(([asked]): IssueDetail | null => (asked === null ? null : this.read(asked)))
    );
  }

  open(key: string): void {
    this.asked.next(key);
  }

  update(patch: Parameters<IssueStore['update']>[1], label: string): void {
    const issue = this.current();
    if (issue !== undefined) {
      this.store.update([issue.id], patch, label, this.me);
    }
  }

  comment(body: string): void {
    const issue = this.current();
    const text = body.trim();
    if (issue === undefined || text === '') {
      return;
    }
    const at = this.clock();
    this.store.comment({ id: `c-${at}-${Math.random().toString(36).slice(2, 8)}`, issueId: issue.id, authorId: this.me, body: text, createdAt: at });
  }

  /**
   * Issues whose key starts with the query, then whose title has a word
   * that does, then whose title contains it; never the open issue itself.
   * A scan of every issue, which at 50,000 takes a few milliseconds and
   * runs in the app worker, off the frame.
   */
  find(query: string): void {
    const wanted = query.trim().toLowerCase();
    const self = this.current()?.id;
    if (wanted === '') {
      this.found.next([]);
      return;
    }
    const ranked: { issue: Issue; rank: number }[] = [];
    for (const issue of this.store.issues()) {
      if (issue.id === self) continue;
      const key = issue.key.toLowerCase();
      const title = issue.title.toLowerCase();
      const rank = key.startsWith(wanted) ? 0 : title.startsWith(wanted) ? 1 : title.includes(` ${wanted}`) ? 2 : title.includes(wanted) ? 3 : -1;
      if (rank >= 0) {
        ranked.push({ issue, rank });
      }
    }
    // Shorter keys first within a rank, so WEB-1 comes before WEB-1042.
    ranked.sort((a, b) => a.rank - b.rank || a.issue.key.length - b.issue.key.length || a.issue.key.localeCompare(b.issue.key));
    this.found.next(ranked.slice(0, FOUND).map(entry => this.ref(entry.issue)));
  }

  setParent(key: string | null): void {
    const issue = this.current();
    if (issue === undefined) return;
    if (key === null) {
      this.store.update([issue.id], { parentId: null }, `Removed ${issue.key} from its parent`, this.me);
      return;
    }
    const parent = this.store.byKey(key);
    // One level: a parent can't itself be a sub-issue, and nothing is its own parent.
    if (parent === undefined || parent.id === issue.id || parent.parentId !== null || this.store.childrenOf(issue.id).length > 0) return;
    this.store.update([issue.id], { parentId: parent.id }, `Made ${issue.key} a sub-issue of ${parent.key}`, this.me);
  }

  addChild(key: string): void {
    const issue = this.current();
    const child = this.store.byKey(key);
    if (issue === undefined || child === undefined || child.id === issue.id || issue.parentId !== null || this.store.childrenOf(child.id).length > 0) return;
    this.store.update([child.id], { parentId: issue.id }, `Made ${child.key} a sub-issue of ${issue.key}`, this.me);
  }

  removeChild(key: string): void {
    const issue = this.current();
    const child = this.store.byKey(key);
    if (issue === undefined || child === undefined || child.parentId !== issue.id) return;
    this.store.update([child.id], { parentId: null }, `Removed ${child.key} from ${issue.key}`, this.me);
  }

  link(key: string, kind: LinkKind): void {
    const issue = this.current();
    const other = this.store.byKey(key);
    if (issue === undefined || other === undefined || other.id === issue.id) return;
    // "Blocked by" and "duplicated by" are the other issue's links, read backwards.
    const backwards = kind === 'blocked-by' || kind === 'duplicated-by';
    const stored: IssueRelation['kind'] = kind === 'blocked-by' ? 'blocks' : kind === 'duplicated-by' ? 'duplicates' : kind;
    this.store.relate(
      {
        id: `r-${this.clock()}-${Math.random().toString(36).slice(2, 8)}`,
        fromId: backwards ? other.id : issue.id,
        toId: backwards ? issue.id : other.id,
        kind: stored
      },
      this.me
    );
  }

  unlink(relationId: string): void {
    const issue = this.current();
    if (issue !== undefined) {
      this.store.unrelate(relationId, issue.id, this.me);
    }
  }

  private parentOf(issue: Issue | null): IssueRef | null {
    const parent = issue?.parentId == null ? undefined : this.store.get(issue.parentId);
    return parent === undefined ? null : this.ref(parent);
  }

  private ref(issue: Issue): IssueRef {
    return {
      id: issue.id,
      key: issue.key,
      title: issue.title,
      stateName: this.names.states.get(issue.stateId) ?? issue.stateId,
      closed: this.closedStates.has(issue.stateId)
    };
  }

  /** A link as read from `issueId`'s end of it. */
  private linkRow(relation: IssueRelation, issueId: string): LinkRow | null {
    const outgoing = relation.fromId === issueId;
    const other = this.store.get(outgoing ? relation.toId : relation.fromId);
    if (other === undefined) return null;
    const phrase =
      relation.kind === 'related' ? 'Related to' : relation.kind === 'blocks' ? (outgoing ? 'Blocks' : 'Blocked by') : outgoing ? 'Duplicates' : 'Duplicated by';
    return { id: relation.id, phrase, other: this.ref(other) };
  }

  private current() {
    const asked = this.asked.value;
    return asked === null ? undefined : this.store.byKey(asked);
  }

  private read(asked: string): IssueDetail {
    const issue = this.store.byKey(asked) ?? null;
    const name = (map: Map<string, string>, id: string | null) => (id === null ? '' : (map.get(id) ?? id));
    return {
      asked,
      issue,
      teamName: issue === null ? '' : name(this.names.teams, issue.teamId),
      stateName: issue === null ? '' : name(this.names.states, issue.stateId),
      assigneeName: issue === null ? '' : name(this.names.users, issue.assigneeId),
      projectName: issue === null ? '' : name(this.names.projects, issue.projectId),
      labels: issue === null ? [] : issue.labelIds.map(id => name(this.names.labels, id)),
      parent: this.parentOf(issue),
      children: issue === null ? [] : this.store.childrenOf(issue.id).map(child => this.ref(child)),
      links: issue === null ? [] : this.store.relationsOf(issue.id).flatMap(relation => this.linkRow(relation, issue.id) ?? []),
      comments:
        issue === null
          ? []
          : this.store.commentsOf(issue.id).map(comment => ({
              id: comment.id,
              author: name(this.names.users, comment.authorId),
              body: comment.body,
              createdAt: comment.createdAt
            })),
      // A comment is shown as itself, so its "commented" event would say it twice.
      activity:
        issue === null
          ? []
          : this.store
              .activityOf(issue.id)
              .filter(event => event.kind !== 'commented')
              .map(event => ({ id: event.id, text: this.describe(event), at: event.at }))
    };
  }

  /** "Ada Okafor moved this from Todo to Done." */
  describe(event: ActivityEvent): string {
    const who = this.names.users.get(event.actorId) ?? 'Someone';
    if (event.kind === 'created') return `${who} created this issue`;
    if (event.kind === 'commented') return `${who} commented`;
    if ((event.kind === 'related' || event.kind === 'unrelated') && event.relation !== undefined) {
      const row = this.linkRow(event.relation, event.issueId);
      const what = row === null ? 'another issue' : `${row.phrase.toLowerCase()} ${row.other.key}`;
      return event.kind === 'related' ? `${who} marked this as ${what}` : `${who} removed the link: ${what}`;
    }
    return `${who} ${event.changes.map(change => this.change(change)).join(', ')}`;
  }

  private change(change: FieldChange): string {
    const label = (field: string, value: unknown): string => {
      if (value === null || value === undefined) return 'nothing';
      switch (field) {
        case 'stateId':
          return this.names.states.get(String(value)) ?? String(value);
        case 'assigneeId':
          return this.names.users.get(String(value)) ?? String(value);
        case 'projectId':
          return this.names.projects.get(String(value)) ?? String(value);
        case 'priority':
          return PRIORITY_NAMES[value as Priority];
        case 'labelIds':
          return (value as string[]).map(id => this.names.labels.get(id) ?? id).join(', ') || 'none';
        default:
          return String(value);
      }
    };
    switch (change.field) {
      case 'stateId':
        return `moved this from ${label('stateId', change.from)} to ${label('stateId', change.to)}`;
      case 'assigneeId':
        return change.to === null ? 'unassigned this' : `assigned this to ${label('assigneeId', change.to)}`;
      case 'priority':
        return `set priority to ${label('priority', change.to)}`;
      case 'labelIds':
        return `set labels to ${label('labelIds', change.to)}`;
      case 'projectId':
        return change.to === null ? 'removed this from its project' : `moved this to ${label('projectId', change.to)}`;
      case 'title':
        return `renamed this to "${String(change.to)}"`;
      case 'description':
        return 'edited the description';
      case 'estimate':
        return change.to === null ? 'removed the estimate' : `estimated this at ${String(change.to)} point${change.to === 1 ? '' : 's'}`;
      case 'dueDate':
        return change.to === null ? 'removed the due date' : `set the due date to ${formatDay(String(change.to))}`;
      case 'parentId': {
        const parent = change.to === null ? undefined : this.store.get(String(change.to));
        return parent === undefined ? 'removed this from its parent' : `made this a sub-issue of ${parent.key}`;
      }
      default:
        return `changed ${change.field}`;
    }
  }
}

/** "Nov 2, 2026", for a `YYYY-MM-DD` date, without a time zone moving it. */
function formatDay(day: string): string {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}
