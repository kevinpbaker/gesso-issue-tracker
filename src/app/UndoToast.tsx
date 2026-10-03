import { map } from 'rxjs/operators';

import { Toast } from 'gesso-components';
import { internalState, type ComponentContext, type Inputs } from 'gesso-framework';

import { Issues, type ChangeNotice } from '../issues/IssuesContract';

/** How long a notice stays up. Longer than Gesso's default, because it offers something. */
const DURATION = 8000;
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
 */
export function UndoToast(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const issues = ctx.channel(Issues);
  const notice = internalState<ChangeNotice | null>(null);
  ctx.effect(issues.view.lastChange, change => (notice.value = change));

  const toast = (change: ChangeNotice) => (
    <Toast
      key={String(change.serial)}
      open={true}
      message={change.kind === 'undo' ? `Undone: ${change.label}` : change.label}
      action={change.kind === 'undo' ? 'Redo' : 'Undo'}
      onAction={() => (change.kind === 'undo' ? issues.send.redo() : issues.send.undo())}
      onClose={() => {
        if (notice.value?.serial === change.serial) notice.value = null;
      }}
      duration={DURATION}
      offset={OFFSET}
    />
  );

  return <column width={0} height={0}>{notice.pipe(map(change => (change === null ? [] : [toast(change)])))}</column>;
}
