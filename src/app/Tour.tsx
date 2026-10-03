import { combineLatest, type Observable } from 'rxjs';
import { distinctUntilChanged, map, pairwise, startWith } from 'rxjs/operators';

import { Button } from 'gesso-components';
import { internalState, RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import { Compose } from '../compose/ComposeContract';
import { Issues } from '../issues/IssuesContract';
import { Views } from '../views/ViewsContract';
import { Preferences } from './PreferencesContract';

/**
 * The guided tour: seven steps through the workflow, for someone who
 * has never seen the app, in about two minutes.
 *
 * It's a panel in the corner, not a dialog: the point is to do each
 * thing in the app itself, so it takes no focus and traps nothing. Each
 * step moves on when its thing is done, read from the same channels the
 * screens use, and Next skips one. A screen reader hears each step as
 * it arrives, through the panel's polite live text.
 *
 * It opens on a first visit and is remembered once finished or put
 * away; the palette's "Take the tour" starts it again.
 */

interface Step {
  readonly title: string;
  readonly body: string;
}

export const TOUR: readonly Step[] = [
  {
    title: 'Triage from the keyboard',
    body: 'The list has focus. Move with j and k (or the arrows), and press x to select an issue.'
  },
  { title: 'Open it', body: 'Press Enter to open the issue under the cursor.' },
  {
    title: 'Change it',
    body: 'Tab to Status and choose another, or edit the title or description. Every change can be undone with Mod+Z.'
  },
  { title: 'File one', body: 'Press c anywhere to file a new issue. Mod+Enter files it.' },
  { title: 'Narrow the list', body: 'Go back to the list (g then l) and add a filter from + Filter.' },
  { title: 'Keep it', body: 'Save the filtered list as a view, from Save view. It appears in the sidebar.' },
  {
    title: 'Find anything',
    body: 'Mod+K opens the palette: every command, every place, and all 50,000 issues by key or title.'
  }
];

/** What finishes each step, as a stream that emits once it's done. */
function doneWhen(ctx: ComponentContext): readonly Observable<boolean>[] {
  const router = ctx.inject(RouterService);
  const issues = ctx.channel(Issues);
  const compose = ctx.channel(Compose);
  const views = ctx.channel(Views);
  const path = router.url.pipe(map(url => url.split('?')[0]!));
  // Moves from one value to another, which is "it happened since the
  // step began" for a step that's watching it.
  const changed = <T,>(source: Observable<T>) =>
    source.pipe(
      distinctUntilChanged(),
      pairwise(),
      map(() => true),
      startWith(false)
    );
  return [
    issues.view.selectedCount.pipe(map(count => count > 0)),
    path.pipe(map(p => p.startsWith('/issue/'))),
    changed(issues.view.undoLabel.pipe(map(label => label ?? ''))),
    changed(compose.view.filed.pipe(map(filed => filed?.serial ?? 0))),
    router.url.pipe(map(url => /^\/team\/[^/]+\/list\?/.test(url))),
    changed(views.view.views.pipe(map(list => list.length))),
    // The last step is finished with its button.
    path.pipe(map(() => false))
  ];
}

export function Tour(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const prefs = ctx.channel(Preferences);
  const step = internalState(0);
  const finish = (): void => prefs.send.setTourDone(true);

  // A step's condition is read from when the step starts, so something
  // already true (an issue selected before the tour reached that step)
  // counts, and a change made in an earlier step doesn't finish a later
  // one: each step subscribes afresh.
  const conditions = doneWhen(ctx);
  let watching: { unsubscribe(): void } | null = null;
  ctx.effect(combineLatest([step, prefs.view.tourDone]), ([at, done]) => {
    watching?.unsubscribe();
    watching = null;
    if (done !== false || at >= TOUR.length - 1) return;
    watching = conditions[at]!.subscribe(met => {
      if (met && step.value === at) step.value = at + 1;
    });
  });
  ctx.onUnmount(() => watching?.unsubscribe());

  const current = step.pipe(map(at => TOUR[at]!));
  const last = step.pipe(map(at => at === TOUR.length - 1));

  const panel = () => (
    <column
      key="tour"
      position="absolute"
      right={16}
      // Clear of the list's selection toolbar, which the first step brings up.
      bottom={72}
      width={300}
      maxWidth={320}
      gap={8}
      padding={16}
      borderRadius={10}
      borderWidth={1}
      borderColor="border"
      backgroundColor="surface"
      role="region"
      label="Tour">
      <text text={step.pipe(map(at => `Tour · ${at + 1} of ${TOUR.length}`))} fontSize={11} fontWeight={600} color="textMuted" />
      {/* Polite, so each step is heard as it arrives without taking focus. */}
      <text text={current.pipe(map(s => s.title))} fontSize={14} fontWeight={600} color="text" role="status" live="polite" />
      <text text={current.pipe(map(s => s.body))} fontSize={13} color="text" textWrap="word" />
      <row gap={8} x="end" y="center">
        <Button label="End the tour" size="small" variant="plain" onClick={finish}>
          <text text="End tour" fontSize={12} color="textMuted" />
        </Button>
        {last.pipe(
          map(isLast =>
            isLast ? (
              <Button key="done" label="Finish the tour" size="small" onClick={finish}>
                <text text="Done" fontSize={12} color="background" />
              </Button>
            ) : (
              <Button key="next" label="Next step" size="small" variant="tonal" onClick={() => (step.value += 1)}>
                <text text="Next" fontSize={12} color="text" />
              </Button>
            )
          )
        )}
      </row>
    </column>
  );

  return (
    <column>
      {prefs.view.tourDone.pipe(
        distinctUntilChanged(),
        map(done => {
          if (done !== false) return [];
          step.value = 0;
          return [panel()];
        })
      )}
    </column>
  );
}
