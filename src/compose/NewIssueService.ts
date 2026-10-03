import { internalState } from 'gesso-framework';

/** Whether the New issue dialog is open: the shell's `c`, the top bar's button and the dialog share it. */
export class NewIssueService {
  readonly open = internalState(false);
}
