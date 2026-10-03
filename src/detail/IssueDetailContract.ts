import { channel } from 'gesso-framework';

import type { Issue, IssueRelation } from '../model/types';

/**
 * One issue, opened by key, and everything its page edits.
 *
 * The app worker holds the store; the page reads this view and sends
 * these commands. Searching for another issue (a parent, a sub-issue,
 * a link) happens here too: fifty thousand issues stay in the worker,
 * and the page gets the handful that match.
 */

export interface CommentRow {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly createdAt: number;
}

export interface ActivityRow {
  readonly id: string;
  readonly text: string;
  readonly at: number;
}

/** Another issue, as a line on this one's page. */
export interface IssueRef {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly stateName: string;
  /** Completed or canceled. */
  readonly closed: boolean;
}

/** A link, as read from this issue: "blocks WEB-2", "blocked by WEB-1". */
export interface LinkRow {
  readonly id: string;
  readonly phrase: string;
  readonly other: IssueRef;
}

export type LinkKind = IssueRelation['kind'] | 'blocked-by' | 'duplicated-by';

export interface IssueDetail {
  /** The key that was asked for, as asked, so a screen can tell its own answer from a stale one. */
  readonly asked: string;
  readonly issue: Issue | null;
  readonly teamName: string;
  readonly stateName: string;
  readonly assigneeName: string;
  readonly projectName: string;
  readonly labels: readonly string[];
  readonly parent: IssueRef | null;
  readonly children: readonly IssueRef[];
  readonly links: readonly LinkRow[];
  readonly comments: readonly CommentRow[];
  readonly activity: readonly ActivityRow[];
}

export interface IssueDetailView {
  detail: IssueDetail | null;
  /** What the last `find` matched, best first. */
  found: readonly IssueRef[];
}

/** A type rather than an interface: a channel's commands must index as a record. */
export type IssueDetailCommands = {
  open(key: string): void;
  update(request: { readonly patch: Partial<Issue>; readonly label: string }): void;
  comment(body: string): void;
  /** Searches every issue by key or title, for a parent, a sub-issue or a link. */
  find(query: string): void;
  /** Makes this a sub-issue of the issue with that key, or of nothing. */
  setParent(key: string | null): void;
  /** Makes the issue with that key a sub-issue of this one. */
  addChild(key: string): void;
  /** Takes a sub-issue out from under this one. */
  removeChild(key: string): void;
  link(request: { readonly key: string; readonly kind: LinkKind }): void;
  unlink(relationId: string): void;
};

export const IssueDetailChannel = channel<IssueDetailView, IssueDetailCommands>('issue-detail', { detail: null, found: [] });
