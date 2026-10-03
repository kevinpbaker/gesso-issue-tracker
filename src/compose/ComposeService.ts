import { BehaviorSubject } from 'rxjs';

import type { IssueStore } from '../model/IssueStore';
import type { TextStore } from '../model/persistence';
import { EMPTY_DRAFT, type Draft, type Filed } from './ComposeContract';

const KEY = 'draft-v1';
/** How long the draft waits for typing to stop before it's written to disk. */
const SAVE_AFTER_MS = 300;

/** The draft of a new issue, saved to disk as it changes, and filing it. Plain RxJS: it runs in node. */
export class ComposeService {
  readonly draft = new BehaviorSubject<Draft | null>(null);
  readonly filed = new BehaviorSubject<Filed | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private serial = 0;

  constructor(
    private readonly issues: IssueStore,
    private readonly disk: TextStore,
    private readonly me = 'u0'
  ) {}

  /** Reads the saved draft; an unreadable one is an empty draft. */
  async restore(): Promise<void> {
    const read = await this.disk.read(KEY);
    let saved: Partial<Draft> = {};
    if (read.outcome === 'ok' && read.value !== null) {
      try {
        saved = JSON.parse(read.value) as Partial<Draft>;
      } catch {
        // A draft that won't parse is no draft.
      }
    }
    this.draft.next(this.valid({ ...EMPTY_DRAFT, ...saved }));
  }

  save(draft: Draft): void {
    this.draft.next(this.valid(draft));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_AFTER_MS);
  }

  /** Writes the draft now, for a tab that's closing. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const draft = this.draft.value;
    if (draft !== null) {
      await this.disk.write(KEY, JSON.stringify(draft));
    }
  }

  /** Files the draft, if it has a title and a team; the dialog checks first, and so does this. */
  file(draft: Draft): void {
    const title = draft.title.replace(/\s+/g, ' ').trim();
    if (title === '' || !this.issues.workspace.teams.some(team => team.id === draft.teamId)) {
      return;
    }
    const issue = this.issues.newIssue({
      teamId: draft.teamId,
      title,
      description: draft.description,
      stateId: draft.stateId,
      priority: draft.priority,
      assigneeId: draft.assigneeId === '' ? null : draft.assigneeId,
      labelIds: draft.labelIds
    });
    this.issues.create(issue, this.me);
    this.serial += 1;
    this.filed.next({ key: issue.key, title, serial: this.serial });
    // What's kept for the next one: with "Create more", every choice
    // but the words, which are this issue's alone.
    this.save(draft.createMore ? { ...draft, title: '', description: '' } : { ...EMPTY_DRAFT, teamId: draft.teamId });
  }

  discard(): void {
    const current = this.draft.value ?? EMPTY_DRAFT;
    this.save({ ...EMPTY_DRAFT, teamId: current.teamId, createMore: current.createMore });
  }

  /** A draft whose choices still exist: a team, state, person or label can't be gone, but a saved draft can outlive one. */
  private valid(draft: Draft): Draft {
    const { teams, states, users, labels } = this.issues.workspace;
    return {
      ...draft,
      teamId: teams.some(team => team.id === draft.teamId) ? draft.teamId : EMPTY_DRAFT.teamId,
      stateId: states.some(state => state.id === draft.stateId) ? draft.stateId : EMPTY_DRAFT.stateId,
      assigneeId: users.some(user => user.id === draft.assigneeId) ? draft.assigneeId : '',
      labelIds: draft.labelIds.filter(id => labels.some(label => label.id === id))
    };
  }
}
