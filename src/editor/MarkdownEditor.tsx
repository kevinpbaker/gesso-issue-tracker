import { Subject, type Observable } from 'rxjs';
import { distinctUntilChanged, filter, map, shareReplay, startWith } from 'rxjs/operators';

import {
  defineModifier,
  editorFor,
  percent,
  type UiBeforeInputEvent,
  type UiEditingGroup,
  type UiGroupEdit,
  type UiKeyboardEvent,
  type UiModifierHost,
  type UiNode,
  type UiTextPosition
} from 'gesso-core';
import { internalState, type ComponentContext, type Inputs } from 'gesso-framework';

import { chunk } from './chunks';
import { DocumentHistory, type Caret, type DocumentState, type EditKind } from './history';
import { inlineRuns } from './inline';
import { block, continuation, detached, inputRule, isList, parse, serialize, type Block } from './markdown';

/**
 * A rich text editor for markdown, drawn by Gesso.
 *
 * The document is a list of blocks (see `markdown.ts`), each edited in
 * an `<editabletext>` of its own and styled with spans over its inline
 * source. The editor owns what spans blocks: splitting and joining,
 * markdown shortcuts as you type, nesting lists with Tab, moving between
 * blocks with the arrows, and one undo history for the whole document.
 *
 * Nothing here imports from the issue tracker, so it can move to
 * `gesso-components` once it's proven.
 *
 * **Chunks.** Blocks are rendered in chunks of a few dozen (see
 * `chunks.ts`), each a column with its own child list. Typing changes
 * one block's text, which reaches that block through its own cell and
 * re-renders nothing; inserting a block re-renders one chunk's children.
 */

export interface MarkdownEditorProps {
  /** The markdown to edit. Read when the editor mounts. */
  value: string;
  /** Called with the document's markdown after every change. */
  onChange?: (markdown: string) => void;
  /** Shows the stored markdown beside the editor, as it changes. */
  showSource?: boolean;
  label?: string;
}

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

const focusRequests = defineModifier<{ id: string; requests: FocusRequests; fields: WeakMap<UiNode, string> }>({
  name: 'focusRequests',
  attach(host: UiModifierHost, args) {
    // Which block a field is, for edits over a selection that spans
    // fields: Gesso reports those by node.
    args.fields.set(host.node, args.id);
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

interface BlockHandlers {
  input(id: string, text: string, caret: number): void;
  /** True when the Enter was the editor's, false to let the field have it. */
  enter(id: string, caret: number): boolean;
  backspaceAtStart(id: string): void;
  indent(id: string, by: 1 | -1, caret: number): boolean;
  toggle(id: string): void;
  undo(): void;
  redo(): void;
  /** The caret moved by itself: the next character starts a new undo step. */
  moved(): void;
}

/** What a block needs from the document around it, as cells. */
interface Context {
  readonly cellFor: (current: Block) => Observable<Block>;
  readonly numberOf: (id: string) => Observable<number>;
  readonly requests: FocusRequests;
  readonly handlers: BlockHandlers;
  readonly fields: WeakMap<UiNode, string>;
}

export function MarkdownEditor(inputs: Inputs<MarkdownEditorProps>, ctx: ComponentContext) {
  const blocks = internalState<readonly Block[]>(parse(inputs.value.value));
  const history = new DocumentHistory();
  const requests = new FocusRequests();
  const fields = new WeakMap<UiNode, string>();

  // Everything the views read, worked out from one document state at a
  // time. Separate streams over \`blocks\` update in subscription order,
  // and a view mounted by one (a chunk re-rendering) read another that
  // hadn't caught up: a block that had just become a heading mounted
  // holding the paragraph it was.
  let starts = new Set<string>();
  const snapshot = blocks.pipe(
    map(list => {
      const byId = new Map(list.map(b => [b.id, b]));
      // Chunks are kept from one edit to the next, so a change lands in one.
      const cut = chunk(list, starts);
      starts = new Set(cut.keys());
      const chunks = new Map([...cut].map(([start, ids]) => [start, ids.map(id => byId.get(id)!)]));
      return { byId, chunks, numbers: numbering(list) };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  const cellFor = (current: Block) =>
    snapshot.pipe(
      map(state => state.byId.get(current.id)),
      filter((b): b is Block => b !== undefined),
      startWith(current),
      distinctUntilChanged()
    );
  const numberOf = (id: string) =>
    snapshot.pipe(
      map(state => state.numbers.get(id) ?? 1),
      distinctUntilChanged()
    );
  const chunks = snapshot.pipe(map(state => state.chunks));
  const chunkKeys = chunks.pipe(
    map(cut => [...cut.keys()].join('|')),
    distinctUntilChanged(),
    map(joined => joined.split('|'))
  );

  const focus = (id: string, caret: number): void => requests.send(id, caret);
  const indexOf = (id: string): number => blocks.value.findIndex(b => b.id === id);

  /** Applies an edit and records it, so it can be undone. */
  const commit = (next: readonly Block[], caret: Caret | null, kind: EditKind, before: DocumentState): void => {
    history.record(before, { blocks: next, caret }, kind);
    blocks.value = next;
    if (caret !== null) {
      focus(caret.id, caret.offset);
    }
  };
  const replaced = (index: number, next: readonly Block[], deleteCount = 1): Block[] => {
    const list = [...blocks.value];
    list.splice(index, deleteCount, ...next);
    return list;
  };
  const here = (id: string, offset: number): DocumentState => ({ blocks: blocks.value, caret: { id, offset } });

  const restore = (state: DocumentState | null): void => {
    if (state === null) {
      return;
    }
    blocks.value = state.blocks;
    if (state.caret !== null) {
      focus(state.caret.id, state.caret.offset);
    }
  };

  const handlers: BlockHandlers = {
    input(id, text, caret) {
      const index = indexOf(id);
      const current = blocks.value[index];
      if (current === undefined || current.text === text) {
        return;
      }
      const grew = text.length >= current.text.length;
      const before = here(id, grew ? Math.max(0, caret - (text.length - current.text.length)) : caret + (current.text.length - text.length));
      const edited = { ...current, text };
      const typed = replaced(index, [edited]);
      // The typing is recorded first and the shortcut it triggered after
      // it, as its own step: undo right after `# ` became a heading gives
      // back the `# `.
      history.record(before, { blocks: typed, caret: { id, offset: caret } }, grew ? 'typing' : 'deleting');
      blocks.value = typed;
      const converted = inputRule(edited);
      if (converted === null) {
        return;
      }
      const after = here(id, caret);
      if (converted.type === 'rule') {
        const next = block('paragraph', '');
        commit(replaced(index, [converted, next]), { id: next.id, offset: 0 }, 'shortcut', after);
      } else {
        commit(replaced(index, [converted]), { id, offset: Math.max(0, caret - (text.length - converted.text.length)) }, 'shortcut', after);
      }
    },
    enter(id, caret) {
      const index = indexOf(id);
      const current = blocks.value[index]!;
      if (current.type === 'code') {
        return false; // a newline inside the code block
      }
      const before = here(id, caret);
      // Enter on an empty list item leaves the list, as every editor does.
      if (isList(current.type) && current.text === '') {
        commit(
          replaced(index, [{ id: current.id, type: 'paragraph', text: '', ...(current.src === undefined ? {} : { src: current.src }) }]),
          { id: current.id, offset: 0 },
          'structure',
          before
        );
        return true;
      }
      const head = { ...current, text: current.text.slice(0, caret) };
      const tail = block(continuation(current).type, current.text.slice(caret), { ...continuation(current), loose: current.loose });
      commit(replaced(index, [head, tail]), { id: tail.id, offset: 0 }, 'structure', before);
      return true;
    },
    backspaceAtStart(id) {
      const index = indexOf(id);
      const current = blocks.value[index]!;
      const before = here(id, 0);
      // First, a formatted block becomes a paragraph; only then does it join.
      if (current.type !== 'paragraph') {
        const next =
          isList(current.type) && (current.indent ?? 0) > 0
            ? { ...current, indent: (current.indent ?? 0) - 1 }
            : { id: current.id, type: 'paragraph' as const, text: current.text, ...(current.src === undefined ? {} : { src: current.src }) };
        commit(replaced(index, [next]), { id: current.id, offset: 0 }, 'structure', before);
        return;
      }
      const previous = blocks.value[index - 1];
      if (previous === undefined) {
        return;
      }
      if (previous.type === 'rule' || previous.type === 'raw') {
        commit(replaced(index - 1, [], 1), { id: current.id, offset: 0 }, 'structure', before);
        return;
      }
      commit(
        replaced(index - 1, [{ ...previous, text: previous.text + current.text }], 2),
        { id: previous.id, offset: previous.text.length },
        'structure',
        before
      );
    },
    indent(id, by, caret) {
      const index = indexOf(id);
      const current = blocks.value[index]!;
      if (!isList(current.type)) {
        return false;
      }
      // An item can sit at most one level deeper than the one above it.
      const above = blocks.value[index - 1];
      const deepest = above !== undefined && isList(above.type) ? (above.indent ?? 0) + 1 : 0;
      const indent = Math.max(0, Math.min(deepest, (current.indent ?? 0) + by));
      if (indent !== (current.indent ?? 0)) {
        commit(replaced(index, [{ ...current, indent }]), { id, offset: caret }, 'structure', here(id, caret));
      }
      return true;
    },
    toggle(id) {
      const index = indexOf(id);
      const current = blocks.value[index]!;
      commit(replaced(index, [{ ...current, checked: current.checked !== true }]), null, 'format', { blocks: blocks.value, caret: null });
    },
    undo: () => restore(history.undo()),
    redo: () => restore(history.redo()),
    moved: () => history.breakRun()
  };

  if (inputs.onChange.value !== undefined) {
    // Every change, written as markdown. Serializing reuses each untouched
    // block's source, so it costs little more than a join.
    ctx.effect(blocks.pipe(map(list => serialize(list)), distinctUntilChanged()), markdown => inputs.onChange.value?.(markdown));
  }

  /** Where a position Gesso reports is, in the document. */
  const locate = (position: UiTextPosition): { index: number; offset: number } | null => {
    const id = fields.get(position.node);
    const index = id === undefined ? -1 : indexOf(id);
    return index < 0 ? null : { index, offset: position.offset };
  };

  // The blocks select as one text. An edit over a selection that spans
  // blocks joins what is left of the first to what is left of the last,
  // as a document editor does: the result keeps the first block's type.
  const group: UiEditingGroup = {
    onEdit(edit: UiGroupEdit) {
      const start = locate(edit.start);
      const end = locate(edit.end);
      if (start === null || end === null) {
        return;
      }
      const list = blocks.value;
      const first = list[start.index]!;
      const last = list[end.index]!;
      const head = first.text.slice(0, start.offset);
      const tail = last.text.slice(end.offset);
      const before = here(first.id, start.offset);
      const count = end.index - start.index + 1;
      if (edit.inputType === 'insertParagraph' || edit.inputType === 'insertLineBreak') {
        const after = block(continuation(first).type, tail, { ...continuation(first), loose: first.loose });
        commit(replaced(start.index, [{ ...first, text: head }, after], count), { id: after.id, offset: 0 }, 'structure', before);
        return;
      }
      const inserted = edit.inputType.startsWith('delete') ? '' : (edit.data ?? '');
      commit(
        replaced(start.index, [{ ...first, text: head + inserted + tail }], count),
        { id: first.id, offset: head.length + inserted.length },
        'structure',
        before
      );
    },
    // Copied as markdown: the selected part of each block, written as
    // the blocks they are.
    copyText(startPosition, endPosition) {
      const start = locate(startPosition);
      const end = locate(endPosition);
      if (start === null || end === null) {
        return '';
      }
      const picked = blocks.value.slice(start.index, end.index + 1).map((current, i, all) => {
        const from = i === 0 ? start.offset : 0;
        const to = i === all.length - 1 ? end.offset : current.text.length;
        return detached({ ...current, text: current.text.slice(from, to) });
      });
      return serialize(picked);
    }
  };

  const context: Context = { cellFor, numberOf, requests, handlers, fields };

  const editor = (
    <scrollview
      flexGrow={1}
      flexBasis={0}
      height={percent(100)}
      borderRadius={10}
      borderWidth={1}
      borderColor="border"
      role="region"
      label={inputs.label.value ?? 'Document'}>
      <column gap={6} padding={20} width={percent(100)} editingGroup={group}>
        {chunkKeys.pipe(
          map(keys =>
            keys.map(start => (
              <ChunkView key={start} members={chunks.pipe(map(cut => cut.get(start) ?? []))} context={context} />
            ))
          )
        )}
      </column>
    </scrollview>
  );

  if (inputs.showSource.value !== true) {
    return (
      <row width={percent(100)} height={percent(100)}>
        {editor}
      </row>
    );
  }
  return (
    <row gap={16} padding={16} width={percent(100)} height={percent(100)} backgroundColor="background">
      {editor}
      <column flexGrow={1} flexBasis={0} height={percent(100)} gap={8}>
        <text text="Stored markdown" fontSize={12} fontWeight={600} color="textMuted" />
        <scrollview flexGrow={1} width={percent(100)} borderRadius={10} backgroundColor="surface" padding={16}>
          <text
            text={blocks.pipe(map(list => serialize(list)))}
            fontSize={12}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            color="text"
            label="Markdown source"
          />
        </scrollview>
      </column>
    </row>
  );
}

/**
 * One chunk of the document: a column whose children are rebuilt only
 * when its own blocks are added, removed, retyped or renested.
 */
function ChunkView(inputs: Inputs<{ members: readonly Block[]; context: Context }>, _ctx: ComponentContext) {
  const context = inputs.context.value;
  // What decides this chunk's children: which blocks, and of what type.
  // Text and depth reach a block through its own cell.
  const structure = inputs.members.pipe(
    distinctUntilChanged((a, b) => a.length === b.length && a.every((x, i) => x.id === b[i]!.id && x.type === b[i]!.type))
  );
  return (
    <column gap={6} width={percent(100)}>
      {structure.pipe(
        map(list =>
          list.map(current => (
            // The type is in the key: a block's layout is built once, so a
            // heading that becomes a list item is a new view.
            <BlockView key={`${current.id}:${current.type}`} block={context.cellFor(current)} number={context.numberOf(current.id)} context={context} />
          ))
        )
      )}
    </column>
  );
}

const HEADING_SIZES = [26, 21, 18, 16, 15, 14];
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function BlockView(inputs: Inputs<{ block: Block; number: number; context: Context }>, _ctx: ComponentContext) {
  const { requests, handlers, fields } = inputs.context.value;
  const current = inputs.block;

  const id = current.value.id;
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
    const { shift, meta, ctrl } = event.modifiers;
    const command = meta || ctrl;
    if (command && (event.key === 'z' || event.key === 'Z')) {
      // The document's history, not the field's, and not the app's either:
      // a key taken here never reaches a shortcut registered above.
      if (shift) handlers.redo();
      else handlers.undo();
      event.preventDefault();
    } else if (command && (event.key === 'y' || event.key === 'Y')) {
      handlers.redo();
      event.preventDefault();
    } else if (event.key === 'Enter' && !shift && caret >= 0 && handlers.enter(id, caret)) {
      event.preventDefault();
    } else if (event.key === 'Backspace' && caret === 0 && !meta && !ctrl) {
      handlers.backspaceAtStart(id);
      event.preventDefault();
    } else if (event.key === 'Tab' && handlers.indent(id, shift ? -1 : 1, Math.max(0, caret))) {
      event.preventDefault();
    } else if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
      // Moving between blocks is Gesso's: the blocks are an editing group.
      handlers.moved();
    }
  };

  const onBeforeInput = (event: UiBeforeInputEvent): void => {
    // Undo from anywhere else (a menu, the platform's own gesture) arrives
    // here rather than as a key.
    if (event.inputType === 'historyUndo') {
      handlers.undo();
      event.preventDefault();
    } else if (event.inputType === 'historyRedo') {
      handlers.redo();
      event.preventDefault();
    }
  };

  const fontSize = type === 'heading' ? HEADING_SIZES[(current.value.level ?? 1) - 1] : type === 'code' ? 13 : 15;
  const raw = type === 'raw';

  const field = (
    <editabletext
      flexGrow={1}
      multiline={true}
      textWrap="word"
      value={current.pipe(map(b => b.text))}
      spans={type === 'code' || raw ? undefined : current.pipe(map(b => inlineRuns(b.text)))}
      fontSize={fontSize}
      fontWeight={type === 'heading' ? 700 : 400}
      fontFamily={type === 'code' || raw ? MONO : undefined}
      color={current.pipe(map(b => (raw || (b.type === 'task' && b.checked === true) ? 'textMuted' : 'text')))}
      placeholder={type === 'paragraph' ? 'Type / for blocks, or markdown' : ''}
      label={label(current.value)}
      onKeyDown={onKeyDown}
      onBeforeInput={onBeforeInput}
      onInput={event => handlers.input(id, event.value, event.selectionEnd)}
      modifiers={[focusRequests({ id, requests, fields })]}
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
              <text text={type === 'bullet' ? '•' : inputs.number.pipe(map(n => `${n}.`))} fontSize={15} color="textMuted" />
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
    case 'raw':
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

/** Each ordered item's number, counted the way the serializer counts them. */
function numbering(list: readonly Block[]): Map<string, number> {
  const out = new Map<string, number>();
  const counters: (number | undefined)[] = [];
  for (const current of list) {
    const at = current.indent ?? 0;
    if (!isList(current.type)) {
      counters.length = 0;
      continue;
    }
    counters.length = at + 1;
    if (current.type === 'ordered') {
      counters[at] = counters[at] === undefined ? (current.ordinal ?? 1) : counters[at]! + 1;
      out.set(current.id, counters[at]!);
    } else {
      counters[at] = undefined;
    }
  }
  return out;
}

function label(current: Block): string {
  switch (current.type) {
    case 'heading':
      return `Heading level ${current.level ?? 1}`;
    case 'task':
      return current.checked === true ? 'Task, done' : 'Task, not done';
    case 'bullet':
    case 'ordered':
      return 'List item';
    case 'code':
      return 'Code block';
    case 'quote':
      return 'Quote';
    case 'raw':
      return 'Markdown, as written';
    default:
      return 'Paragraph';
  }
}
