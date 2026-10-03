/**
 * The workspace's shapes.
 *
 * Plain data only: every one of these crosses the worker barrier, and
 * the channel wire refuses anything whose prototype is not
 * `Object.prototype`. Dates are epoch milliseconds for the same reason.
 */

export type Priority = 0 | 1 | 2 | 3 | 4;

export const PRIORITY_NAMES: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low'
};

export interface WorkflowState {
  readonly id: string;
  readonly name: string;
  readonly type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
}

export interface User {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
}

export interface Label {
  readonly id: string;
  readonly name: string;
}

export interface Team {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly teamId: string;
}

export interface Issue {
  readonly id: string;
  /** Team-prefixed, `WEB-1042`. */
  readonly key: string;
  readonly teamId: string;
  readonly projectId: string | null;
  readonly title: string;
  /** Markdown. */
  readonly description: string;
  readonly stateId: string;
  readonly priority: Priority;
  readonly assigneeId: string | null;
  readonly labelIds: readonly string[];
  /** Points, or null for no estimate. */
  readonly estimate: number | null;
  /** A calendar date, `YYYY-MM-DD`, or null. A string, so no time zone puts it a day out. */
  readonly dueDate: string | null;
  /** The issue this is a sub-issue of, by id. One level: a sub-issue has no sub-issues of its own. */
  readonly parentId: string | null;
  /**
   * Manual order within a workflow state, smallest first. A move writes
   * one rank between its new neighbours rather than renumbering the
   * column, so a drag is one patch to one issue.
   */
  readonly rank: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Comment {
  readonly id: string;
  readonly issueId: string;
  readonly authorId: string;
  /** Markdown. */
  readonly body: string;
  readonly createdAt: number;
}

/**
 * A link between two issues. `blocks` and `duplicates` read from
 * `fromId` to `toId` ("WEB-1 blocks WEB-2"); `related` reads both ways.
 */
export interface IssueRelation {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly kind: 'related' | 'blocks' | 'duplicates';
}

/** One field that changed, for the activity feed. */
export interface FieldChange {
  readonly field: keyof Issue;
  readonly from: unknown;
  readonly to: unknown;
}

export interface ActivityEvent {
  readonly id: string;
  readonly issueId: string;
  readonly actorId: string;
  readonly at: number;
  readonly kind: 'created' | 'updated' | 'commented' | 'related' | 'unrelated';
  readonly changes: readonly FieldChange[];
  /** For `related` and `unrelated`, the link. */
  readonly relation?: IssueRelation;
}

export interface Workspace {
  readonly teams: readonly Team[];
  readonly projects: readonly Project[];
  readonly states: readonly WorkflowState[];
  readonly users: readonly User[];
  readonly labels: readonly Label[];
  readonly issues: readonly Issue[];
  readonly comments: readonly Comment[];
  readonly relations: readonly IssueRelation[];
}
