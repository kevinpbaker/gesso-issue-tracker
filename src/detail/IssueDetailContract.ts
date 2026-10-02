import { channel } from 'gesso-framework';

import type { Issue } from '../model/types';

/**
 * One issue, opened by key. Phase 6 grows this into the editable detail
 * page; Phase 2 needs the route to land on something real.
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

export interface IssueDetail {
  /** The key that was asked for, as asked, so a screen can tell its own answer from a stale one. */
  readonly asked: string;
  readonly issue: Issue | null;
  readonly teamName: string;
  readonly stateName: string;
  readonly assigneeName: string;
  readonly projectName: string;
  readonly labels: readonly string[];
  readonly comments: readonly CommentRow[];
  readonly activity: readonly ActivityRow[];
}

export interface IssueDetailView {
  detail: IssueDetail | null;
}

/** A type rather than an interface: a channel's commands must index as a record. */
export type IssueDetailCommands = {
  open(key: string): void;
  update(request: { readonly patch: Partial<Issue>; readonly label: string }): void;
  comment(body: string): void;
};

export const IssueDetailChannel = channel<IssueDetailView, IssueDetailCommands>('issue-detail', { detail: null });
