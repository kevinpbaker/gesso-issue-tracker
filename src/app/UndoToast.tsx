import { map } from 'rxjs/operators';

import { Toast } from 'gesso-components';
import { internalState, type ComponentContext, type Inputs } from 'gesso-framework';

import { Issues, type ChangeNotice } from '../issues/IssuesContract';
import { CommandsService } from '../palette/CommandsService';

/** How long a change's notice stays up. Longer than Gesso's default, because it offers something. */
const DURATION = 8000;
/** How long a command's note stays up: it offers nothing, so it needn't wait. */
const SAID_DURATION = 2500;
/**
 * Off the bottom left corner by more than the list's selection toolbar
 * (52 px) is tall, so the two never cover each other. The tour sits in
 * the bottom right corner, at the same height.
 */
const OFFSET = 72;

/**
 * "Moved 12 issues to Done", Undo: a notice after every change made
 * anywhere in the app, from the list, the board, the issue page, the
 * palette or the new issue dialog, read from the app worker's history.
 *
 * Undoing says what it undid, with Redo, rather than nothing: Mod+Z
 * pressed without looking needs to say what it took back, and the next
 * notice ("Undone: Moved 12 issues to Done") is the only place that's
 * written. A redo reads as the change itself again, with Undo.
 *
 * Each change raises a new toast rather than editing the one that's up,
 * as Gesso's `Toast` asks: its name is read when it opens, so a toast
 * keyed by the change's serial is what a screen reader hears afresh. It
 * is a polite status, so it never interrupts, and takes no focus; Mod+Z
 * does what its button does from anywhere. Typing in a description, which
 * saves at every pause, raises none (the app worker leaves it out).
 *
 * It's also where a command says what it did (`CommandsService.say`):
 * "Copied WEB-12's link", with nothing to undo. One place for both, so
 * a copy made just after a change replaces the change's notice rather
 * than landing on top of it, which two notices of their own did on a
 * narrow window. Mod+Z still undoes the change.
 */
export function UndoToast(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const issues = ctx.channel(Issues);
  const commands = ctx.inject(CommandsService);
  type Notice = { readonly kind: 'change'; readonly change: ChangeNotice } | { readonly kind: 'said'; readonly text: string; readonly round: number };
  const notice = internalState<Notice | null>(null);
  // A reset's null takes a change's notice down; a note goes by itself.
  ctx.effect(issues.view.lastChange, change => {
    if (change !== null) notice.value = { kind: 'change', change };
    else if (notice.value?.kind === 'change') notice.value = null;
  });
  ctx.effect(commands.notice, said => {
    if (said !== null) notice.value = { kind: 'said', text: said.text, round: said.round };
  });

  const toast = (shown: Notice) => {
    const key = shown.kind === 'change' ? `change:${shown.change.serial}` : `said:${shown.round}`;
    const close = () => {
      if (notice.value === shown) notice.value = null;
    };
    if (shown.kind === 'said') {
      return <Toast key={key} open={true} message={shown.text} onClose={close} duration={SAID_DURATION} offset={OFFSET} />;
    }
    const change = shown.change;
    return (
      <Toast
        key={key}
        open={true}
        message={change.kind === 'undo' ? `Undone: ${change.label}` : change.label}
        action={change.kind === 'undo' ? 'Redo' : 'Undo'}
        onAction={() => (change.kind === 'undo' ? issues.send.redo() : issues.send.undo())}
        onClose={close}
        duration={DURATION}
        offset={OFFSET}
      />
    );
  };

  return <column width={0} height={0}>{notice.pipe(map(shown => (shown === null ? [] : [toast(shown)])))}</column>;
}
