import { Subject } from 'rxjs';
import { distinctUntilChanged, filter, map, shareReplay, startWith } from 'rxjs/operators';

import { defineModifier, editorFor, percent, type UiKeyboardEvent, type UiModifierHost } from 'gesso-core';
import { internalState, type ComponentContext, type Inputs } from 'gesso-framework';

import { SAMPLE } from './bigDocument';
import { inlineRuns } from './inline';
import { block, continuation, inputRule, isList, parse, serialize, type Block } from './markdown';

/**
 * Phase 0's throwaway editor: one `<editabletext>` per block.
 *
 * It exists to find out where Gesso's editing node stops being enough
 * for a document editor, not to be one. What it does:
 *
 *  - loads markdown into blocks and serializes back on every edit;
 *  - styles inline markdown with spans over the typed source;
 *  - turns `# `, `- `, `1. `, `[ ] `, `> `, three backticks and `---`
 *    into blocks as you type them;
 *  - splits a block on Enter, joins on Backspace at its start, nests
 *    lists with Tab, and moves between blocks with the arrows.
 *
 * What it cannot do, and why, is the point: see PHASE0.md §4.
 */

interface FocusRequest {
  readonly id: string;
  readonly caret: number;
}

/**
 * Sends focus into a block and places the caret.
 *
 * Gesso has `autoFocus` for a node that takes focus when it mounts. An
 * editor needs more: focus sent to a block that already exists, or to
 * one the same edit is creating and that has no node yet. So the
 * request is held until a block with that ID attaches or hears it,
 * whichever comes first.
 */
class FocusRequests {
  private pending: FocusRequest | null = null;
  readonly stream = new Subject<FocusRequest>();

  send(id: string, caret: number): void {
    this.pending = { id, caret };
    this.stream.next(this.pending);
  }

  /** Called by the block that took it, so a later attach does not take it again. */
  take(id: string): FocusRequest | null {
    if (this.pending?.id !== id) {
      return null;
    }
    const request = this.pending;
    this.pending = null;
    return request;
  }
}

const focusRequests = defineModifier<{ id: string; requests: FocusRequests }>({
  name: 'focusRequests',
  attach(host: UiModifierHost, args) {
    const apply = (): void => {
      const request = args.requests.take(args.id);
      if (request === null) {
        return;
      }
      host.focus();
      // `editorFor` syncs the node's current `value` first, so the caret
      // is clamped against the text this edit produced.
      const model = editorFor(host.node);
      const caret = Math.min(request.caret, model.text.length);
      model.select(caret, caret);
    };
    apply();
    const subscription = args.requests.stream.pipe(filter(request => request.id === args.id)).subscribe(apply);
    host.own(() => subscription.unsubscribe());
  }
});



export function EditorSpike(inputs: Inputs<{ markdown?: string; showSource?: boolean }>, _ctx: ComponentContext) {
  const blocks = internalState<readonly Block[]>(parse(inputs.markdown.value ?? SAMPLE));
  const requests = new FocusRequests();
  const source = blocks.pipe(map(list => serialize(list)));

  // The children are rebuilt only when the *structure* changes: which
  // blocks exist, in what order, of what type and depth. Typing changes
  // one block's text, which reaches that block through its own cell and
  // nothing else, so the column's child list is not re-emitted and the
  // layout engine re-measures one paragraph instead of the document.
  // This was the difference between ~40 ms and ~1 ms a keystroke in the
  // 5,000-line document; see PHASE0.md §4.
  const byId = blocks.pipe(
    map(list => new Map(list.map(b => [b.id, b]))),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  // Seeded with the block as it is now: a block created by an edit
  // mounts while that edit is still being delivered, before `byId` has
  // heard of it, and a component's first read must not be undefined.
  const cellFor = (current: Block) =>
    byId.pipe(
      map(index => index.get(current.id)),
      filter((b): b is Block => b !== undefined),
      startWith(current),
      distinctUntilChanged()
    );
  const structure = blocks.pipe(
    map(list => list.map(b => `${b.id}:${b.type}:${b.indent ?? 0}`).join('|')),
    distinctUntilChanged()
  );

  const focus = (id: string, caret: number): void => requests.send(id, caret);

  const replace = (index: number, next: readonly Block[], deleteCount = 1): void => {
    const list = [...blocks.value];
    list.splice(index, deleteCount, ...next);
    blocks.value = list;
  };

  const indexOf = (id: string): number => blocks.value.findIndex(b => b.id === id);

  const handlers: BlockHandlers = {
    input(id, text, caret) {
      const index = indexOf(id);
      const current = blocks.value[index];
      if (current === undefined || current.text === text) {
        return;
      }
      const edited = { ...current, text };
      const converted = inputRule(edited);
      if (converted === null) {
        replace(index, [edited]);
        return;
      }
      replace(index, [converted]);
      if (converted.type === 'rule') {
        const after = block('paragraph', '');
        replace(index + 1, [after], 0);
        focus(after.id, 0);
      } else {
        focus(converted.id, Math.max(0, caret - (text.length - converted.text.length)));
      }
    },
    enter(id, caret) {
      const index = indexOf(id);
      const current = blocks.value[index]!;
      if (current.type === 'code') {
        return false; // a newline inside the code block
      }
      // Enter on an empty list item leaves the list, as every editor does.
      if (isList(current.type) && current.text === '') {
        replace(index, [{ ...current, type: 'paragraph', indent: undefined, checked: undefined }]);
        focus(current.id, 0);
        return true;
      }
      const before = { ...current, text: current.text.slice(0, caret) };
      const after = block(continuation(current).type, current.text.slice(caret), continuation(current));
      replace(index, [before, after]);
      focus(after.id, 0);
      return true;
    },
    backspaceAtStart(id) {
      const index = indexOf(id);
      const current = blocks.value[index]!;
      // First, a formatted block becomes a paragraph; only then does it join.
      if (current.type !== 'paragraph') {
        if (isList(current.type) && (current.indent ?? 0) > 0) {
          replace(index, [{ ...current, indent: (current.indent ?? 0) - 1 }]);
        } else {
          replace(index, [{ id: current.id, type: 'paragraph', text: current.text }]);
        }
        focus(current.id, 0);
        return;
      }
      const previous = blocks.value[index - 1];
      if (previous === undefined) {
        return;
      }
      if (previous.type === 'rule') {
        replace(index - 1, [], 1);
        focus(current.id, 0);
        return;
      }
      replace(index - 1, [{ ...previous, text: previous.text + current.text }], 2);
      focus(previous.id, previous.text.length);
    },
    indent(id, by) {
      const index = indexOf(id);
      const current = blocks.value[index]!;
      if (!isList(current.type)) {
        return false;
      }
      replace(index, [{ ...current, indent: Math.max(0, Math.min(6, (current.indent ?? 0) + by)) }]);
      return true;
    },
    toggle(id) {
      const index = indexOf(id);
      const current = blocks.value[index]!;
      replace(index, [{ ...current, checked: current.checked !== true }]);
    },
    step(id, direction, caret) {
      const index = indexOf(id);
      const target = blocks.value[index + direction];
      if (target === undefined) {
        return false;
      }
      focus(target.id, direction < 0 ? target.text.length : Math.min(caret, target.text.length));
      return true;
    }
  };

  return (
    <row gap={16} padding={16} width={percent(100)} height={percent(100)} backgroundColor="background">
      <scrollview flexGrow={1} flexBasis={0} height={percent(100)} borderRadius={10} borderWidth={1} borderColor="border">
        <column gap={6} padding={20} width={percent(100)}>
          {structure.pipe(
            map(() => {
              let number = 0;
              return blocks.value.map(current => {
                number = current.type === 'ordered' ? number + 1 : 0;
                return (
                  // The type is in the key: a block's layout is built once,
                  // so a heading that becomes a list item is a new view.
                  <BlockView
                    key={`${current.id}:${current.type}`}
                    block={cellFor(current)}
                    number={number}
                    requests={requests}
                    handlers={handlers}
                  />
                );
              });
            })
          )}
        </column>
      </scrollview>
      {inputs.showSource.value === false ? null : (
        <column flexGrow={1} flexBasis={0} height={percent(100)} gap={8}>
          <text text="Stored markdown" fontSize={12} fontWeight={600} color="textMuted" />
          <scrollview flexGrow={1} width={percent(100)} borderRadius={10} backgroundColor="surface" padding={16}>
            <text
              text={source}
              fontSize={12}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              color="text"
              label="Markdown source"
            />
          </scrollview>
        </column>
      )}
    </row>
  );
}

interface BlockHandlers {
  input(id: string, text: string, caret: number): void;
  /** True when the Enter was the editor's, false to let the field have it. */
  enter(id: string, caret: number): boolean;
  backspaceAtStart(id: string): void;
  indent(id: string, by: 1 | -1): boolean;
  toggle(id: string): void;
  step(id: string, direction: 1 | -1, caret: number): boolean;
}

const HEADING_SIZES = [26, 21, 18, 16, 15, 14];
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function BlockView(
  inputs: Inputs<{ block: Block; number: number; requests: FocusRequests; handlers: BlockHandlers }>,
  _ctx: ComponentContext
) {
  const id = inputs.block.value.id;
  const handlers = inputs.handlers.value;

  const current = inputs.block;
  const type = current.value.type;

  if (type === 'rule') {
    return <box height={1} width={percent(100)} marginTop={10} marginBottom={10} backgroundColor="border" label="Divider" />;
  }

  const onKeyDown = (event: UiKeyboardEvent): void => {
    // The caret is read from the field's own model at the moment of the
    // key, not tracked from events: a caret placed programmatically
    // (by a focus request) raises no selection event.
    if (event.currentTarget === null) {
      return;
    }
    const model = editorFor(event.currentTarget);
    const caret = model.collapsed ? model.focus : -1;
    const length = model.text.length;
    const shift = event.modifiers.shift;
    if (event.key === 'Enter' && !shift && caret >= 0 && handlers.enter(id, caret)) {
      event.preventDefault();
    } else if (event.key === 'Backspace' && caret === 0 && !event.modifiers.meta && !event.modifiers.ctrl) {
      handlers.backspaceAtStart(id);
      event.preventDefault();
    } else if (event.key === 'Tab' && handlers.indent(id, shift ? -1 : 1)) {
      event.preventDefault();
    } else if (event.key === 'ArrowUp' && caret === 0 && handlers.step(id, -1, caret)) {
      event.preventDefault();
    } else if (event.key === 'ArrowDown' && caret === length && handlers.step(id, 1, 0)) {
      event.preventDefault();
    }
  };

  const fontSize = type === 'heading' ? HEADING_SIZES[(current.value.level ?? 1) - 1] : type === 'code' ? 13 : 15;

  const field = (
    <editabletext
      flexGrow={1}
      multiline={true}
      textWrap="word"
      value={current.pipe(map(b => b.text))}
      spans={type === 'code' ? undefined : current.pipe(map(b => inlineRuns(b.text)))}
      fontSize={fontSize}
      fontWeight={type === 'heading' ? 700 : 400}
      fontFamily={type === 'code' ? MONO : undefined}
      color={current.pipe(map(b => (b.type === 'task' && b.checked === true ? 'textMuted' : 'text')))}
      placeholder={type === 'paragraph' ? 'Type / for blocks, or markdown' : ''}
      label={label(current.value)}
      onKeyDown={onKeyDown}
      onInput={event => {
        handlers.input(id, event.value, event.selectionEnd);
      }}
      modifiers={[focusRequests({ id, requests: inputs.requests.value })]}
    />
  );

  // Bound, not read once: Tab changes a block's depth without remounting it.
  const indent = current.pipe(map(b => (b.indent ?? 0) * 22));

  switch (type) {
    case 'bullet':
    case 'ordered':
    case 'task':
      return (
        <row gap={8} paddingLeft={indent} y="start" width={percent(100)}>
          <box width={22} height={22} x="end" y="center">
            {type === 'task' ? (
              <button
                label={current.pipe(map(b => (b.checked === true ? 'Mark not done' : 'Mark done')))}
                onClick={() => handlers.toggle(id)}
                width={16}
                height={16}
                borderRadius={4}
                borderWidth={1.5}
                borderColor={current.pipe(map(b => (b.checked === true ? 'primary' : 'textMuted')))}
                backgroundColor={current.pipe(map(b => (b.checked === true ? 'primary' : 'background')))}
                cursor="pointer"
                x="center"
                y="center">
                <text text={current.pipe(map(b => (b.checked === true ? '✓' : '')))} fontSize={11} color="background" />
              </button>
            ) : (
              <text
                text={type === 'bullet' ? '•' : inputs.number.pipe(map(n => `${n}.`))}
                fontSize={15}
                color="textMuted"
              />
            )}
          </box>
          {field}
        </row>
      );
    case 'quote':
      return (
        <row gap={12} width={percent(100)}>
          <box width={3} borderRadius={2} backgroundColor="border" />
          {field}
        </row>
      );
    case 'code':
      return (
        <box width={percent(100)} padding={12} borderRadius={8} backgroundColor="surface">
          {field}
        </box>
      );
    default:
      return (
        <box width={percent(100)} paddingTop={type === 'heading' ? 8 : 0}>
          {field}
        </box>
      );
  }
}

function label(current: Block): string {
  switch (current.type) {
    case 'heading':
      return `Heading level ${current.level ?? 1}`;
    case 'task':
      return 'Task';
    case 'bullet':
    case 'ordered':
      return 'List item';
    case 'code':
      return 'Code block';
    case 'quote':
      return 'Quote';
    default:
      return 'Paragraph';
  }
}
