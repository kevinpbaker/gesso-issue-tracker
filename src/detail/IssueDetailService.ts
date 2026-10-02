import { BehaviorSubject, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';

import type { IssueStore } from '../model/IssueStore';
import { PRIORITY_NAMES, type ActivityEvent, type FieldChange, type Priority } from '../model/types';
import type { IssueDetail } from './IssueDetailContract';

/** One open issue, re-read from the store on every change. Plain RxJS, so it runs in node. */
export class IssueDetailService {
  private readonly asked = new BehaviorSubject<string | null>(null);
  readonly detail;

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
      default:
        return `changed ${change.field}`;
    }
  }
}
