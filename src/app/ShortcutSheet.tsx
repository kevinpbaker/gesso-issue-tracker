import { BehaviorSubject, combineLatest } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { autoFocus, describeShortcut, percent, parseShortcut, shortcutKeyCaps, type UiChild, type UiKeyboardEvent, type UiShortcutBinding } from 'gesso-core';
import { Dialog } from 'gesso-components';
import { FocusService, internalState, RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import { EDITOR_SHORTCUTS } from '../editor/MarkdownEditor';
import { KEYBOARD_SHORTCUTS, ShortcutsService } from './ShortcutsService';

/** One thing the sheet lists: what it does, and every key that does it. */
export interface SheetRow {
  readonly label: string;
  /** Each key that does it, as caps: one array per press, one string per key. */
  readonly keys: readonly (readonly (readonly string[])[])[];
  /** "Next issue, j or Down arrow": the row's name, as a screen reader says it. */
  readonly name: string;
}

export interface SheetSection {
  readonly group: string;
  readonly rows: readonly SheetRow[];
}

/** The heading for a shortcut registered without a group: the shell's own, which work everywhere. */
const GLOBAL = 'Global';
const EDITOR = 'Editor';

/**
 * The sheet's contents, from what the registry says is live.
 *
 * A key two live shortcuts want is listed for the one that would run,
 * and keys that share a label share a row: j and ↓ are one "Next
 * issue". The shell's own come first, then each screen's in the order
 * they registered, then the editor's when there's an editor to type
 * in, which it handles itself and so aren't in the registry.
 */
export function sheetSections(active: readonly UiShortcutBinding[], editor: boolean): SheetSection[] {
  const groups = new Map<string, Map<string, UiShortcutBinding['steps'][]>>();
  const add = (group: string, label: string, steps: UiShortcutBinding['steps']): void => {
    const rows = groups.get(group) ?? new Map<string, UiShortcutBinding['steps'][]>();
    groups.set(group, rows);
    rows.set(label, [...(rows.get(label) ?? []), steps]);
  };
  const taken = new Set<string>();
  for (const binding of active) {
    // The first live binding for some keys is the one that runs.
    if (taken.has(binding.display)) continue;
    taken.add(binding.display);
    add(binding.group ?? GLOBAL, binding.label, binding.steps);
  }
  if (editor) {
    for (const { keys, label } of EDITOR_SHORTCUTS) add(EDITOR, label, parseShortcut(keys));
  }
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b));
  return order.map(group => ({
    group,
    rows: [...groups.get(group)!].map(([label, steps]) => ({
      label,
      keys: steps.map(each => shortcutKeyCaps(each)),
      name: `${label}, ${steps.map(each => describeShortcut(each)).join(' or ')}`
    }))
  }));
}

/** Global first and the editor last; the screens' between, as they came (a stable sort). */
function rank(group: string): number {
  return group === GLOBAL ? 0 : group === EDITOR ? 2 : 1;
}

/**
 * The sections whose rows match every word typed, each as the start of
 * a word in what they do, their group, or their keys: "down" finds
 * "Down arrow" and not "markdown".
 */
export function filterSections(sections: readonly SheetSection[], query: string): SheetSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 0);
  if (words.length === 0) return [...sections];
  return sections
    .map(section => ({
      group: section.group,
      rows: section.rows.filter(row => {
        const said = `${section.group} ${row.name} ${row.keys.flat(2).join(' ')}`.toLowerCase().split(/[\s,]+/);
        return words.every(word => said.some(each => each.startsWith(word)));
      })
    }))
    .filter(section => section.rows.length > 0);
}

/** The screens with a markdown editor on them: an issue's page and the sample documents. */
function hasEditor(url: string): boolean {
  return /^\/(issue|editor)(\/|$|\?)/.test(url);
}

/**
 * Every keyboard shortcut that works here, on `?`.
 *
 * It reads the shortcut registry as it opens, against where focus was,
 * so it lists what would run, the same list the command palette offers,
 * and can't go stale. A filter at the top narrows it as you type; `?`
 * there (it's in no shortcut's name) or Escape closes it, and so does
 * `?` anywhere else in it, which is the shortcut again.
 */
export function ShortcutSheet(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const service = ctx.inject(ShortcutsService);
  const focus = ctx.inject(FocusService);
  const router = ctx.inject(RouterService);
  const sections = new BehaviorSubject<readonly SheetSection[]>([]);
  const query = new BehaviorSubject('');
  const open = internalState(false);

  // Read before the dialog takes focus, so it's what was live where the
  // person was.
  ctx.effect(service.sheetOpen.pipe(distinctUntilChanged()), want => {
    if (want) {
      sections.next(sheetSections(service.registry.active(focus.focused.value), hasEditor(router.url.value)));
      query.next('');
    }
    open.value = want;
  });
  const close = (): void => {
    service.sheetOpen.value = false;
  };

  return (
    <column width={0} height={0}>
      <Dialog
        open={open}
        onClose={close}
        title={KEYBOARD_SHORTCUTS}
        width={520}
        content={<SheetBody sections={sections} query={query} onQuery={text => query.next(text)} onClose={close} />}
      />
    </column>
  );
}

function SheetBody(
  inputs: Inputs<{ sections: readonly SheetSection[]; query: string; onQuery: (text: string) => void; onClose: () => void }>,
  _ctx: ComponentContext
) {
  const shown = combineLatest([inputs.sections, inputs.query]).pipe(map(([sections, query]) => filterSections(sections, query)));
  const onKeyDown = (event: UiKeyboardEvent): void => {
    // A `?` typed here is the shortcut, not a filter: no name has one.
    if (event.key === '?') {
      event.preventDefault();
      event.stopPropagation();
      inputs.onClose.value();
    }
  };
  return (
    // minHeight 0, so on a short window the column gives up height
    // rather than keeping what its list asks for; the list below is what
    // gives it.
    <column gap={12} width={percent(100)} minHeight={0}>
      <editabletext
        value={inputs.query}
        placeholder="Filter shortcuts…"
        fontSize={14}
        padding={8}
        paddingLeft={10}
        textWrap="none"
        color="text"
        backgroundColor="background"
        borderColor="border"
        borderWidth={1}
        borderRadius={6}
        role="searchbox"
        label="Filter shortcuts"
        modifiers={[autoFocus()]}
        onInput={event => inputs.onQuery.value(event.value)}
        onKeyDown={onKeyDown}
      />
      {/* A fixed height, so the dialog, centred, stays put as a filter
          shortens the list; and room on the right for the scroll bar.
          Less on a window too short for it: the dialog fits the window,
          and the list takes what's left under the filter. */}
      <scrollview height={420} minHeight={0}>
        <column gap={16} paddingRight={14}>
          {shown.pipe(
            map(sections =>
              sections.length === 0
                ? [<text key="none" text="No shortcut matches" fontSize={13} color="textMuted" padding={4} />]
                : sections.map(section => <Section key={section.group} section={section} />)
            )
          )}
        </column>
      </scrollview>
    </column>
  );
}

function Section(inputs: Inputs<{ section: SheetSection }>, _ctx: ComponentContext) {
  const section = inputs.section;
  return (
    <column gap={2}>
      <text text={section.pipe(map(s => s.group))} role="heading" fontSize={11} fontWeight={600} color="textMuted" paddingBottom={4} />
      <column role="list" label={section.pipe(map(s => s.group))}>
        {section.pipe(
          map(s =>
            s.rows.map((row, index) => (
              <row key={row.label} role="listitem" label={row.name} posInSet={index + 1} setSize={s.rows.length} gap={12} paddingY={5} y="center">
                <text text={row.label} fontSize={13} color="text" flexGrow={1} flexShrink={1} />
                <row gap={6} y="center" flexShrink={0}>
                  {row.keys.flatMap((presses, at) => [
                    ...(at === 0 ? [] : [<text key={`or${at}`} text="or" fontSize={11} color="textMuted" />]),
                    <row key={`k${at}`} gap={3} y="center">
                      {presses.flatMap((caps, step) => [
                        ...(step === 0 ? [] : [<text key={`then${step}`} text="then" fontSize={11} color="textMuted" />]),
                        ...caps.map((cap, i) => <KeyCap key={`${step}:${i}`} text={cap} />)
                      ])}
                    </row>
                  ])}
                </row>
              </row>
            ))
          )
        )}
      </column>
    </column>
  );
}

/** One key, drawn as a key. */
function KeyCap(inputs: Inputs<{ text: string }>, _ctx: ComponentContext): UiChild {
  return (
    <box minWidth={22} height={22} paddingX={6} x="center" y="center" backgroundColor="background" borderColor="border" borderWidth={1} borderRadius={5}>
      <text text={inputs.text} fontSize={12} color="text" />
    </box>
  );
}
