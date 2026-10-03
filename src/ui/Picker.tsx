import { BehaviorSubject, combineLatest } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { autoFocus, type UiKeyboardEvent, type UiNode } from 'gesso-core';
import { filterCombobox, useOverlay, type ComboboxOption } from 'gesso-components';
import { FocusService, ScrollService, type ComponentContext, type Inputs } from 'gesso-framework';

export interface PickerOption extends ComboboxOption {
  /** What the issue has now, ticked. */
  readonly checked?: boolean;
}

/** What to pick, for which issues, and where. */
export interface PickerRequest {
  /** The picker's name: "Set the status of WEB-12". */
  readonly title: string;
  /** The search field's name: "Status". */
  readonly label: string;
  readonly options: readonly PickerOption[];
  /** The node it opens beside: the row or card it acts on. */
  readonly anchor: UiNode | null;
  readonly onChoose: (value: string) => void;
}

/**
 * A small list to choose one thing from, opened by a key beside what
 * it changes: type to narrow it, the arrows to walk it, Enter to choose,
 * Escape to leave.
 *
 * Gesso's `Combobox` is a field that sits in a form and `Menu` can't be
 * searched, so this is the command palette's shape at the size of a
 * menu: a search field that keeps focus, with the highlighted option
 * as its active descendant, over a listbox, in an overlay that traps
 * focus while it's open and gives it back when it closes. Matching is
 * the combobox's own (`filterCombobox`): a label's start, a word's
 * start, anywhere, then a keyword.
 */
export function Picker(inputs: Inputs<{ request: PickerRequest | null; onClose: () => void }>, ctx: ComponentContext) {
  const focus = ctx.inject(FocusService);
  const scroll = ctx.inject(ScrollService);
  const overlay = useOverlay(ctx, 'picker');

  const query = new BehaviorSubject('');
  const options = new BehaviorSubject<readonly PickerOption[]>([]);
  const active = new BehaviorSubject(0);
  const rows = new Map<string, UiNode>();
  const rowsChanged = new BehaviorSubject(0);
  let trapped = false;
  let placeholder: UiNode | null = null;
  let choose: (value: string) => void = () => {};

  const matches = combineLatest([options, query]).pipe(map(([all, text]) => filterCombobox(all, text) as PickerOption[]));
  let matchesNow: readonly PickerOption[] = [];
  ctx.effect(matches, list => {
    matchesNow = list;
    active.next(0);
  });
  const activeNode = combineLatest([active, matches, rowsChanged]).pipe(
    map(([at, list]) => rows.get(list[at]?.value ?? '') ?? null),
    distinctUntilChanged()
  );
  ctx.effect(activeNode, node => {
    if (node !== null) scroll.scrollIntoView(node, 4);
  });

  const release = (): void => {
    if (trapped) {
      trapped = false;
      focus.releaseTrap();
    }
  };
  ctx.onUnmount(release);

  const close = (): void => {
    if (overlay.isOpen()) overlay.hide();
  };

  /** Closed first, so focus is back on the list or the board when the change lands. */
  const pick = (option: PickerOption | undefined): void => {
    if (option === undefined || option.disabled === true) return;
    const chosen = choose;
    close();
    chosen(option.value);
  };

  const onKeyDown = (event: UiKeyboardEvent): void => {
    const consume = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const last = matchesNow.length - 1;
    if (event.key === 'ArrowDown') active.next(Math.min(last, active.value + 1));
    else if (event.key === 'ArrowUp') active.next(Math.max(0, active.value - 1));
    else if (event.key === 'Home') active.next(0);
    else if (event.key === 'End') active.next(Math.max(0, last));
    else if (event.key === 'Enter') pick(matchesNow[active.value]);
    else if (event.key === 'Escape' || event.key === 'Tab') close();
    else return;
    consume();
  };

  const body = (request: PickerRequest) => (
    <column
      ref={(node: UiNode | null) => {
        if (node !== null && !trapped) {
          trapped = true;
          focus.trap(node);
        }
      }}
      role="dialog"
      label={request.title}
      width={260}
      backgroundColor="surface"
      borderColor="border"
      borderWidth={1}
      borderRadius={8}>
      <editabletext
        value={query}
        placeholder={`${request.label}…`}
        fontSize={13}
        padding={10}
        textWrap="none"
        color="text"
        role="combobox"
        label={request.label}
        states={['expanded']}
        activeDescendant={activeNode}
        modifiers={[autoFocus()]}
        onInput={event => query.next(event.value)}
        onKeyDown={onKeyDown}
      />
      <box height={1} backgroundColor="border" />
      <scrollview maxHeight={280}>
        <column padding={4} role="listbox" label={request.label}>
          {matches.pipe(
            map(list =>
              list.length === 0
                ? [<text key="none" text="Nothing matches" fontSize={13} color="textMuted" padding={8} />]
                : list.map((option, index) => (
                    <row
                      key={option.value}
                      ref={(node: UiNode | null) => {
                        if (node === null) rows.delete(option.value);
                        else rows.set(option.value, node);
                        rowsChanged.next(rowsChanged.value + 1);
                      }}
                      role="option"
                      label={option.label}
                      description={option.detail}
                      // What the issue has now; the highlight is the active descendant.
                      states={option.checked === true ? ['selected'] : []}
                      posInSet={index + 1}
                      setSize={list.length}
                      padding={7}
                      paddingLeft={8}
                      borderRadius={4}
                      gap={8}
                      y="center"
                      cursor="pointer"
                      backgroundColor={active.pipe(map(at => (at === index ? 'controlBackgroundHovered' : 'transparent')))}
                      onClick={() => pick(option)}>
                      <text text={option.checked === true ? '✓' : ''} fontSize={12} color="text" width={12} />
                      <text text={option.label} fontSize={13} color="text" flexGrow={1} flexShrink={1} maxLines={1} textOverflow="ellipsis" />
                      {option.detail === undefined ? [] : [<text key="detail" text={option.detail} fontSize={11} color="textMuted" />]}
                    </row>
                  ))
            )
          )}
        </column>
      </scrollview>
    </column>
  );

  ctx.effect(inputs.request.pipe(distinctUntilChanged()), request => {
    if (request === null) {
      close();
      return;
    }
    close();
    choose = request.onChoose;
    options.next(request.options);
    query.next('');
    // The highlight starts on what the issue has now, when it has one thing.
    const ticked = request.options.filter(option => option.checked === true);
    active.next(ticked.length === 1 ? Math.max(0, request.options.indexOf(ticked[0]!)) : 0);
    overlay.show(body(request), {
      anchor: request.anchor,
      placement: 'bottom-start',
      offset: 4,
      environment: placeholder,
      dismissOnOutsidePress: true,
      onClose: () => {
        release();
        inputs.onClose.value();
      }
    });
  });

  return <box ref={(node: UiNode | null) => (placeholder = node)} width={0} height={0} />;
}
