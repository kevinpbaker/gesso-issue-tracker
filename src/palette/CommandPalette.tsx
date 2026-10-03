import { BehaviorSubject, combineLatest } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';

import { autoFocus, type UiChild, type UiKeyboardEvent, type UiNode } from 'gesso-core';
import { useOverlay } from 'gesso-components';
import { FocusService, RouterService, ScrollService, type ComponentContext, type Inputs } from 'gesso-framework';

import { ShortcutsService } from '../app/ShortcutsService';
import { CommandsService, type PaletteCommand } from './CommandsService';
import { Palette, type PaletteItem } from './PaletteContract';

/**
 * The command palette: Mod+K, then type.
 *
 * It lists every command there is (every keyboard shortcut live where
 * focus was, and every command a screen offers) and, once something is
 * typed, the issues whose key or title match. Before anything is typed,
 * the issues opened lately come first. Matching is the app worker's,
 * fuzzy, so `stdn` finds "Set status: Done".
 *
 * Focus stays in the search field; the arrows walk a highlight that is
 * the field's `activeDescendant`, Enter runs it and Escape closes. The
 * palette closes before a command runs, so the command acts where focus
 * was when the palette opened.
 *
 * It also shows what a command had to say (`CommandsService.say`), such
 * as "Copied WEB-12's link": a small note at the bottom of the window
 * for a moment, read out politely, and taking no focus.
 */
export function CommandPalette(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const service = ctx.inject(CommandsService);
  const { registry } = ctx.inject(ShortcutsService);
  const focus = ctx.inject(FocusService);
  const router = ctx.inject(RouterService);
  const scroll = ctx.inject(ScrollService);
  const palette = ctx.channel(Palette);
  const overlay = useOverlay(ctx, 'palette');
  const note = useOverlay(ctx, 'palette-notice');

  const query = new BehaviorSubject('');
  const active = new BehaviorSubject(0);
  const rows = new Map<string, UiNode>();
  const rowsChanged = new BehaviorSubject(0);
  /** The commands as they were when the palette opened, by id. */
  let commands = new Map<string, PaletteCommand>();
  let trapped = false;
  /** Where the palette is declared, whose theme its content takes. */
  let placeholder: UiNode | null = null;

  // Only the answer to what's in the field now.
  const items = combineLatest([palette.view.results, query]).pipe(
    filter(([results, text]) => results.asked === text),
    map(([results]) => results.items),
    distinctUntilChanged()
  );
  let itemsNow: readonly PaletteItem[] = [];
  ctx.effect(items, list => {
    itemsNow = list;
    active.next(0);
  });
  const activeNode = combineLatest([active, items, rowsChanged]).pipe(
    map(([at, list]) => rows.get(itemKey(list[at])) ?? null),
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

  const run = (item: PaletteItem | undefined): void => {
    if (item === undefined) return;
    close();
    // After the trap is gone and focus is back where it was, so a
    // command scoped to that place acts on it.
    setTimeout(() => {
      if (item.kind === 'issue') {
        router.navigate(`/issue/${item.id}`);
      } else {
        commands.get(item.id)?.run();
      }
    }, 0);
  };

  const show = (): void => {
    if (overlay.isOpen()) return;
    // What's live depends on where focus is, so it's read before the
    // palette takes focus for itself.
    const shortcuts: PaletteCommand[] = registry.active(focus.focused.value).map(binding => ({
      id: `keys:${binding.keys}:${binding.label}`,
      label: binding.label,
      group: binding.group ?? 'Shortcuts',
      keys: binding.display,
      run: binding.run
    }));
    const labels = new Set(shortcuts.map(command => command.label));
    const all = [...shortcuts, ...service.commands().filter(command => !labels.has(command.label))];
    commands = new Map(all.map(command => [command.id, command]));
    palette.send.setCatalog(all.map(({ id, label, group, keywords }) => ({ id, label, group, keywords })));
    palette.send.setOpenIssue(openIssue(router.url.value));
    query.next('');
    palette.send.search('');
    overlay.show(body(), {
      top: 80,
      center: 'x',
      environment: placeholder,
      dismissOnOutsidePress: true,
      onClose: () => {
        release();
        service.open.value = false;
      }
    });
  };

  ctx.effect(service.open.pipe(distinctUntilChanged()), open => (open ? show() : close()));

  // What a command said: shown for a moment, and read out from a status
  // that's always there, since one that arrives already holding its text
  // isn't reliably read. It's emptied afterwards, so the same words next
  // time are a change a screen reader hears.
  const said = new BehaviorSubject('');
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  ctx.onUnmount(() => clearTimeout(noteTimer));
  ctx.effect(service.notice, notice => {
    if (notice === null) return;
    clearTimeout(noteTimer);
    said.next(notice.text);
    note.hide();
    note.show(
      <row padding={8} paddingLeft={12} paddingRight={12} borderRadius={8} backgroundColor="surface" borderColor="border" borderWidth={1}>
        <text text={notice.text} fontSize={12} color="text" selectable={false} />
      </row>,
      { bottom: 24, center: 'x', environment: placeholder }
    );
    noteTimer = setTimeout(() => {
      note.hide();
      said.next('');
    }, NOTICE_MS);
  });

  const onKeyDown = (event: UiKeyboardEvent): void => {
    const consume = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === 'ArrowDown') {
      active.next(Math.min(itemsNow.length - 1, active.value + 1));
      consume();
    } else if (event.key === 'ArrowUp') {
      active.next(Math.max(0, active.value - 1));
      consume();
    } else if (event.key === 'Enter') {
      run(itemsNow[active.value]);
      consume();
    } else if (event.key === 'Escape') {
      close();
      consume();
    }
  };

  const body = () => (
    <column
      ref={(node: UiNode | null) => {
        if (node !== null && !trapped) {
          trapped = true;
          focus.trap(node);
        }
      }}
      role="dialog"
      label="Command palette"
      width={560}
      backgroundColor="surface"
      borderColor="border"
      borderWidth={1}
      borderRadius={12}>
      <editabletext
        value={query}
        placeholder="Type a command or search issues…"
        fontSize={15}
        padding={14}
        textWrap="none"
        color="text"
        role="combobox"
        label="Command or issue"
        states={['expanded']}
        activeDescendant={activeNode}
        modifiers={[autoFocus()]}
        onInput={event => {
          query.next(event.value);
          palette.send.search(event.value);
        }}
        onKeyDown={onKeyDown}
      />
      <box height={1} backgroundColor="border" />
      <scrollview maxHeight={420}>
        <column padding={6} role="listbox" label="Commands and issues">
          {items.pipe(
            map(list => {
              const out: UiChild[] = [];
              let group = '';
              list.forEach((item, index) => {
                if (item.group !== group) {
                  group = item.group;
                  // Keyed by place too: a ranked list can come back to a
                  // group it left, and two headings can't share a key.
                  out.push(<text key={`g:${index}:${group}`} text={group} fontSize={11} fontWeight={600} color="textMuted" paddingLeft={10} paddingTop={8} paddingBottom={4} />);
                }
                const command = item.kind === 'command' ? commands.get(item.id) : undefined;
                out.push(
                  <row
                    key={itemKey(item)}
                    ref={(node: UiNode | null) => {
                      if (node === null) rows.delete(itemKey(item));
                      else rows.set(itemKey(item), node);
                      rowsChanged.next(rowsChanged.value + 1);
                    }}
                    role="option"
                    label={item.label}
                    description={command?.keys}
                    posInSet={index + 1}
                    setSize={list.length}
                    padding={8}
                    paddingLeft={10}
                    borderRadius={6}
                    gap={8}
                    y="center"
                    backgroundColor={active.pipe(map(at => (at === index ? 'controlBackgroundHovered' : 'transparent')))}
                    onClick={() => run(item)}>
                    <text text={item.label} fontSize={13} color="text" flexGrow={1} flexShrink={1} maxLines={1} textOverflow="ellipsis" />
                    {command?.keys === undefined ? [] : [<text key="keys" text={command.keys} fontSize={11} color="textMuted" />]}
                  </row>
                );
              });
              return out.length === 0 ? [<text key="none" text="Nothing matches" fontSize={13} color="textMuted" padding={10} />] : out;
            })
          )}
        </column>
      </scrollview>
    </column>
  );

  return (
    <box ref={(node: UiNode | null) => (placeholder = node)} width={0} height={0}>
      <text text={said} label={said} role="status" live="polite" height={0} opacity={0} />
    </box>
  );
}

/** How long a command's note stays up. */
const NOTICE_MS = 2500;

/** The key of the issue whose page is open, from the url; null on any other screen. */
function openIssue(url: string): string | null {
  const match = /^\/issue\/([^/?#]+)/.exec(url);
  return match === null ? null : decodeURIComponent(match[1]!);
}

function itemKey(item: PaletteItem | undefined): string {
  return item === undefined ? '' : `${item.kind}:${item.id}`;
}
