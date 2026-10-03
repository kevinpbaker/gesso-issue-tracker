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
import { Button, useOverlay } from 'gesso-components';
import { EditingService, FocusService, internalState, type ComponentContext, type Inputs } from 'gesso-framework';

import { chunk } from './chunks';
import { copiedHtml } from './copyHtml';
import { DocumentHistory, type Caret, type DocumentState, type EditKind } from './history';
import { inlineRuns } from './inline';
import { makeLink, toggleMark, type Mark } from './formatting';
import {
  block,
  caretToSource,
  continuation,
  detached,
  inputRule,
  isList,
  parse,
  serialize,
  serializeWithRanges,
  sourceToCaret,
  type Block
} from './markdown';
import { pastedBlocks, pastedMarkdown } from './paste';
import { applySlash, filterSlash, slashQuery, type SlashItem } from './slash';

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
  /**
   * Grows with its content rather than filling its container and
   * scrolling inside it: a description on a page that scrolls, a comment
   * box.
   */
  fit?: boolean;
  /** Shown in the empty document. */
  placeholder?: string;
  /** Mod+Enter, from anywhere in the editor: sending a comment. */
  onSubmit?: () => void;
  /** Focus left the editor, having been in it: the moment to save. */
  onBlur?: () => void;
}

interface FocusRequest {
  readonly id: string;
  readonly caret: number;
  /** Where the selection starts, when it isn't just a caret. */
  readonly anchor?: number;
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

  send(id: string, caret: number, anchor?: number): void {
    this.pending = anchor === undefined ? { id, caret } : { id, caret, anchor };
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

const focusRequests = defineModifier<{ id: string; requests: FocusRequests; fields: Fields }>({
  name: 'focusRequests',
  attach(host: UiModifierHost, args) {
    // Which block a field is, for edits over a selection that spans
    // fields: Gesso reports those by node, and is told them by node.
    args.fields.block.set(host.node, args.id);
    args.fields.node.set(args.id, host.node);
    host.own(() => {
      if (args.fields.node.get(args.id) === host.node) {
        args.fields.node.delete(args.id);
      }
    });
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
      model.select(Math.min(request.anchor ?? caret, model.text.length), caret);
    };
    apply();
    const subscription = args.requests.stream.pipe(filter(request => request.id === args.id)).subscribe(apply);
    host.own(() => subscription.unsubscribe());
  }
});

/** Fields and blocks, each way round. */
interface Fields {
  readonly block: WeakMap<UiNode, string>;
  readonly node: Map<string, UiNode>;
}

interface BlockHandlers {
  input(id: string, text: string, caret: number): void;
  /** True when the Enter was the editor's, false to let the field have it. */
  enter(id: string, caret: number): boolean;
  backspaceAtStart(id: string): void;
  indent(id: string, by: 1 | -1, caret: number): boolean;
  toggle(id: string): void;
  /** Bold, italic, code, strikethrough or a link over the block's selection, or over a selection across blocks. */
  format(id: string, kind: Mark | 'link', start: number, end: number): void;
  /** True when the editor took the paste, false to let the field insert it as text. */
  paste(id: string, start: number, end: number, text: string, html: string | null): boolean;
  undo(): void;
  redo(): void;
  /** The caret moved by itself: the next character starts a new undo step. */
  moved(): void;
  /** A block took focus. */
  focused(id: string): void;
  /** A key while the slash menu is open over this block: true when the menu took it. */
  slashKey(id: string, key: string): boolean;
  /** Turns the slash menu's block into the chosen kind. */
  slashPick(value: string): void;
  /** Switches between the formatted document and its markdown. */
  toggleSource(): void;
  /** Mod+Enter. */
  submit(): void;
}

/** The slash menu, while it is open: which block, what's typed after the slash, which item is lit. */
interface SlashState {
  readonly id: string;
  readonly query: string;
  readonly index: number;
}

/** What a block needs from the document around it, as cells. */
interface Context {
  readonly cellFor: (current: Block) => Observable<Block>;
  readonly numberOf: (id: string) => Observable<number>;
  readonly requests: FocusRequests;
  readonly handlers: BlockHandlers;
  readonly fields: Fields;
  /** What an empty paragraph says: the editor's placeholder while the document is empty. */
  readonly placeholder: Observable<string>;
}

export function MarkdownEditor(inputs: Inputs<MarkdownEditorProps>, ctx: ComponentContext) {
  const blocks = internalState<readonly Block[]>(parse(inputs.value.value));
  const history = new DocumentHistory();
  const requests = new FocusRequests();
  const fields: Fields = { block: new WeakMap(), node: new Map() };
  const slash = internalState<SlashState | null>(null);
  /** Whether the document is shown formatted or as its markdown. */
  const mode = internalState<'rich' | 'source'>('rich');
  /** The markdown the source view opened with. */
  const sourceText = internalState('');
  const sourceRequests = new FocusRequests();
  const focusService = ctx.inject(FocusService);
  const menu = useOverlay(ctx, 'slash-menu');
  const editing = ctx.inject(EditingService);

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

  const focus = (id: string, caret: number, anchor?: number): void => requests.send(id, caret, anchor);
  const indexOf = (id: string): number => blocks.value.findIndex(b => b.id === id);

  /** Applies an edit and records it, so it can be undone. */
  const commit = (
    next: readonly Block[],
    caret: Caret | null,
    kind: EditKind,
    before: DocumentState,
    anchor?: number
  ): void => {
    history.record(before, { blocks: next, caret }, kind);
    blocks.value = next;
    if (caret !== null) {
      focus(caret.id, caret.offset, anchor);
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

  /** The selection across blocks, while there is one; see the group below. */
  let span: { start: { index: number; offset: number }; end: { index: number; offset: number } } | null = null;

  /** Whether a block's text is inline markdown that formatting and pasting apply to. */
  const inline = (current: Block): boolean => current.type !== 'code' && current.type !== 'raw' && current.type !== 'rule';

  /**
   * Replaces a range of the document, from a place in one block to a
   * place in the same or a later one, with inline text or with pasted
   * blocks, as one undo step.
   *
   * Pasted blocks are spliced in the way a document editor does it: the
   * first joins the text before the range when both are plain text, the
   * last takes the text after it, and everything between stands as it
   * was pasted. Text pasted at the start of a list item keeps the item.
   */
  const replaceRange = (
    start: { index: number; offset: number },
    end: { index: number; offset: number },
    insertion: string | readonly Block[]
  ): void => {
    const list = blocks.value;
    const first = list[start.index]!;
    const last = list[end.index]!;
    const head = first.text.slice(0, start.offset);
    const tail = last.text.slice(end.offset);
    const count = end.index - start.index + 1;
    const before = here(first.id, start.offset);
    if (typeof insertion === 'string' || insertion.length === 0) {
      const text = typeof insertion === 'string' ? insertion : '';
      commit(
        replaced(start.index, [{ ...first, text: head + text + tail }], count),
        { id: first.id, offset: head.length + text.length },
        'structure',
        before
      );
      return;
    }
    const pasted = [...insertion];
    const out: Block[] = [];
    if (head !== '' || first.type !== 'paragraph') {
      if (pasted[0]!.type === 'paragraph' && inline(first)) {
        out.push({ ...first, text: head + pasted.shift()!.text });
      } else if (head !== '') {
        out.push({ ...first, text: head });
      }
    }
    out.push(...pasted);
    if (out.length === 0) {
      out.push({ ...first, text: head });
    }
    const end_ = out[out.length - 1]!;
    const caret = { id: end_.id, offset: end_.text.length };
    if (tail !== '') {
      if (inline(end_)) {
        out[out.length - 1] = { ...end_, text: end_.text + tail };
      } else {
        out.push(block('paragraph', tail));
      }
    }
    commit(replaced(start.index, out, count), caret, 'structure', before);
  };

  /**
   * Pastes over a range, pinned by block so that it still lands right
   * if the HTML converter had to be loaded first (see `paste.ts`).
   */
  const pasteAt = async (
    from: { id: string; offset: number },
    to: { id: string; offset: number },
    text: string,
    html: string | null
  ): Promise<void> => {
    const markdown = await pastedMarkdown(text, html);
    const start = indexOf(from.id);
    const end = indexOf(to.id);
    if (start < 0 || end < start) {
      return;
    }
    replaceRange({ index: start, offset: from.offset }, { index: end, offset: to.offset }, pastedBlocks(markdown) ?? markdown);
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
      // `/` at the start of an empty paragraph opens the slash menu, and
      // what follows it filters the menu.
      const query = edited.type === 'paragraph' ? slashQuery(text) : null;
      if (query !== null) {
        const open = slash.value;
        slash.value = { id, query, index: open !== null && open.id === id && open.query === query ? open.index : 0 };
      } else if (slash.value?.id === id) {
        slash.value = null;
      }
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
    format(id, kind, start, end) {
      if (span !== null) {
        // Over every block the selection covers, each block's part.
        const { start: from, end: to } = span;
        const list = [...blocks.value];
        let first: { id: string; offset: number } | null = null;
        let last: { id: string; offset: number } | null = null;
        for (let index = from.index; index <= to.index; index++) {
          const current = list[index]!;
          const a = index === from.index ? from.offset : 0;
          const b = index === to.index ? to.offset : current.text.length;
          if (!inline(current) || b <= a || kind === 'link') {
            continue;
          }
          const done = toggleMark(current.text, a, b, kind);
          list[index] = { ...current, text: done.text };
          first ??= { id: current.id, offset: done.start };
          last = { id: current.id, offset: done.end };
        }
        if (first === null || last === null) {
          return;
        }
        history.record({ blocks: blocks.value, caret: null }, { blocks: list, caret: last }, 'format');
        blocks.value = list;
        // Still selected, from the first block's part to the last's.
        const anchor = fields.node.get(first.id);
        const end = fields.node.get(last.id);
        if (anchor === undefined || end === undefined || !editing.select({ node: anchor, offset: first.offset }, { node: end, offset: last.offset })) {
          focus(last.id, last.offset);
        }
        return;
      }
      const index = indexOf(id);
      const current = blocks.value[index];
      if (current === undefined || !inline(current)) {
        return;
      }
      const done = kind === 'link' ? makeLink(current.text, start, end) : toggleMark(current.text, start, end, kind);
      commit(replaced(index, [{ ...current, text: done.text }]), { id, offset: done.end }, 'format', here(id, end), done.start);
    },
    paste(id, start, end, text, html) {
      const current = blocks.value[indexOf(id)];
      if (current === undefined || !inline(current)) {
        return false;
      }
      if (html === null && pastedBlocks(text) === null) {
        // One plain line: the field's to insert, as typing is.
        return false;
      }
      void pasteAt({ id, offset: start }, { id, offset: end }, text, html);
      return true;
    },
    focused(id) {
      if (slash.value !== null && slash.value.id !== id) {
        slash.value = null;
      }
    },
    slashKey(id, key) {
      const open = slash.value;
      if (open === null || open.id !== id) {
        return false;
      }
      const items = filterSlash(open.query);
      switch (key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          const step = key === 'ArrowDown' ? 1 : -1;
          slash.value = { ...open, index: items.length === 0 ? 0 : (open.index + step + items.length) % items.length };
          return true;
        }
        case 'Enter':
        case 'Tab': {
          const item = items[open.index];
          if (item === undefined) {
            return false;
          }
          handlers.slashPick(item.value);
          return true;
        }
        case 'Escape':
          slash.value = null;
          return true;
        default:
          return false;
      }
    },
    slashPick(value) {
      const open = slash.value;
      slash.value = null;
      const index = open === null ? -1 : indexOf(open.id);
      const current = blocks.value[index];
      if (current === undefined) {
        return;
      }
      // One step after the typing, so undo gives back the `/query` typed.
      const made = applySlash(current, value);
      const target = made.find(b => b.type !== 'rule') ?? made[0]!;
      commit(replaced(index, made), { id: target.id, offset: 0 }, 'shortcut', here(current.id, current.text.length));
    },
    toggleSource() {
      if (mode.value === 'rich') {
        // The caret goes to the same character in the markdown.
        const written = serializeWithRanges(blocks.value);
        const node = focusService.focused.value;
        const id = node === null ? undefined : fields.block.get(node);
        const at = node === null || id === undefined ? 0 : caretToSource(blocks.value, written, { id, offset: editorFor(node).focus });
        slash.value = null;
        sourceText.value = written.text;
        mode.value = 'source';
        sourceRequests.send(SOURCE, at);
        return;
      }
      const field = fields.node.get(SOURCE);
      const text = field === undefined ? sourceText.value : editorFor(field).text;
      const at = field === undefined ? 0 : editorFor(field).focus;
      // Unchanged markdown keeps the blocks it came from; edited markdown
      // is read again, as one step that undo takes back.
      const changed = text !== serialize(blocks.value);
      const next = changed ? parse(text) : blocks.value;
      const caret = sourceToCaret(next, serializeWithRanges(next), at);
      mode.value = 'rich';
      if (changed) {
        commit(next, caret, 'structure', { blocks: blocks.value, caret: null });
      } else if (caret !== null) {
        focus(caret.id, caret.offset);
      }
    },
    undo: () => restore(history.undo()),
    redo: () => restore(history.redo()),
    moved: () => history.breakRun(),
    submit: () => inputs.onSubmit.value?.()
  };

  // Leaving the editor, which may be a block or the source view, is
  // focus moving to a node outside its root.
  let root: UiNode | null = null;
  let inside = false;
  ctx.effect(focusService.focused, node => {
    let within = false;
    for (let current = node; current !== null && root !== null; current = current.parent) {
      if (current === root) {
        within = true;
        break;
      }
    }
    if (inside && !within) {
      inputs.onBlur.value?.();
    }
    inside = within;
  });
  const placeholder = blocks.pipe(
    map(list =>
      list.length === 1 && list[0]!.type === 'paragraph' && list[0]!.text === '' && inputs.placeholder.value !== undefined
        ? inputs.placeholder.value
        : 'Type / for blocks, or markdown'
    ),
    distinctUntilChanged()
  );

  if (inputs.onChange.value !== undefined) {
    // Every change, written as markdown. Serializing reuses each untouched
    // block's source, so it costs little more than a join.
    ctx.effect(blocks.pipe(map(list => serialize(list)), distinctUntilChanged()), markdown => inputs.onChange.value?.(markdown));
  }

  /** Where a position Gesso reports is, in the document. */
  const locate = (position: UiTextPosition): { index: number; offset: number } | null => {
    const id = fields.block.get(position.node);
    const index = id === undefined ? -1 : indexOf(id);
    return index < 0 ? null : { index, offset: position.offset };
  };

  // The blocks select as one text. An edit over a selection that spans
  // blocks joins what is left of the first to what is left of the last,
  // as a document editor does: the result keeps the first block's type.
  const group: UiEditingGroup = {
    onSelectionChange(selection) {
      const start = selection === null ? null : locate(selection.start);
      const end = selection === null ? null : locate(selection.end);
      span = start === null || end === null ? null : { start, end };
    },
    onEdit(edit: UiGroupEdit) {
      const start = locate(edit.start);
      const end = locate(edit.end);
      if (start === null || end === null) {
        return;
      }
      if (edit.inputType === 'insertFromPaste') {
        const list = blocks.value;
        void pasteAt(
          { id: list[start.index]!.id, offset: start.offset },
          { id: list[end.index]!.id, offset: end.offset },
          edit.data ?? '',
          edit.html ?? null
        );
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
      const picked = pick(startPosition, endPosition);
      return picked === null ? '' : serialize(picked);
    },
    // And as HTML, for pasting where markdown would show its asterisks.
    copyHtml(startPosition, endPosition) {
      const picked = pick(startPosition, endPosition);
      return picked === null ? null : copiedHtml(picked);
    }
  };

  /**
   * The blocks a selection covers, cut to it. Part of one block's text
   * is copied as text, not as the block: a word from a heading pastes
   * as a word, not as a heading. Code stays code.
   */
  function pick(startPosition: UiTextPosition, endPosition: UiTextPosition): Block[] | null {
    const start = locate(startPosition);
    const end = locate(endPosition);
    if (start === null || end === null) {
      return null;
    }
    const picked = blocks.value.slice(start.index, end.index + 1).map((current, i, all) => {
      const from = i === 0 ? start.offset : 0;
      const to = i === all.length - 1 ? end.offset : current.text.length;
      return detached({ ...current, text: current.text.slice(from, to) });
    });
    const only = picked.length === 1 ? blocks.value[start.index]! : null;
    if (only !== null && picked[0]!.text !== only.text && only.type !== 'code' && only.type !== 'raw') {
      return [block('paragraph', picked[0]!.text)];
    }
    return picked;
  }

  // The slash menu floats under its block, outside the document, with no
  // backdrop: focus stays in the block, so typing goes on filtering it.
  ctx.effect(
    slash.pipe(
      map(open => open?.id ?? null),
      distinctUntilChanged()
    ),
    id => {
      const anchor = id === null ? undefined : fields.node.get(id);
      if (anchor === undefined) {
        menu.hide();
        return;
      }
      menu.show(<SlashMenu state={slash} onPick={value => handlers.slashPick(value)} />, {
        anchor,
        placement: 'bottom-start',
        offset: 4,
        environment: anchor
      });
    }
  );

  const context: Context = { cellFor, numberOf, requests, handlers, fields, placeholder };
  const fit = inputs.fit.value === true;

  const content = (
    <column gap={6} padding={fit ? 12 : 20} width={percent(100)} editingGroup={group}>
      {chunkKeys.pipe(
        map(keys =>
          keys.map(start => <ChunkView key={start} members={chunks.pipe(map(cut => cut.get(start) ?? []))} context={context} />)
        )
      )}
    </column>
  );
  const editor = fit ? (
    <column width={percent(100)} borderRadius={10} borderWidth={1} borderColor="border" role="region" label={inputs.label.value ?? 'Document'}>
      {content}
    </column>
  ) : (
    <scrollview
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      width={percent(100)}
      borderRadius={10}
      borderWidth={1}
      borderColor="border"
      role="region"
      label={inputs.label.value ?? 'Document'}>
      {content}
    </scrollview>
  );

  const sourceBox = fit
    ? { width: percent(100), borderRadius: 10, borderWidth: 1, borderColor: 'border', padding: 12 }
    : { flexGrow: 1, flexBasis: 0, minHeight: 0, width: percent(100), borderRadius: 10, borderWidth: 1, borderColor: 'border', padding: 20 };
  const source = (
    <scrollview {...sourceBox}>
      <editabletext
        width={percent(100)}
        multiline={true}
        textWrap="word"
        value={sourceText}
        fontFamily={MONO}
        fontSize={13}
        color="text"
        label="Markdown"
        onInput={event => inputs.onChange.value?.(event.value)}
        onKeyDown={event => {
          const command = event.modifiers.meta || event.modifiers.ctrl;
          if (command && event.modifiers.shift && event.key.toLowerCase() === 'm') {
            handlers.toggleSource();
            event.preventDefault();
          } else if (command && event.key === 'Enter') {
            handlers.submit();
            event.preventDefault();
          }
        }}
        modifiers={[focusRequests({ id: SOURCE, requests: sourceRequests, fields })]}
      />
    </scrollview>
  );

  // The same document, formatted or as markdown, with a switch between.
  const body = (
    <column
      ref={node => (root = node)}
      flexGrow={1}
      flexBasis={0}
      {...(fit ? {} : { height: percent(100) })}
      gap={fit ? 4 : 8}>
      <row width={percent(100)} x="end">
        <Button
          size="small"
          variant="plain"
          label={mode.pipe(map(m => (m === 'rich' ? 'View markdown source' : 'View formatted')))}
          onClick={() => handlers.toggleSource()}>
          <text text={mode.pipe(map(m => (m === 'rich' ? 'Markdown' : 'Formatted')))} fontSize={12} color="textMuted" />
        </Button>
      </row>
      {mode.pipe(map(m => (m === 'rich' ? editor : source)))}
    </column>
  );

  if (inputs.showSource.value !== true) {
    return (
      <row width={percent(100)} {...(fit ? {} : { height: percent(100) })}>
        {body}
      </row>
    );
  }
  return (
    <row gap={16} padding={16} width={percent(100)} height={percent(100)} backgroundColor="background">
      {body}
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

/** The slash menu's list: the items the query matches, the lit one marked. */
function SlashMenu(inputs: Inputs<{ state: SlashState | null; onPick: (value: string) => void }>, _ctx: ComponentContext) {
  const items = inputs.state.pipe(map(open => (open === null ? [] : filterSlash(open.query))));
  const lit = inputs.state.pipe(map(open => open?.index ?? 0));
  const row = (item: SlashItem, index: number) => (
    <button
      key={item.value}
      role="option"
      label={item.label}
      states={lit.pipe(map(at => (at === index ? ['selected' as const] : [])))}
      onClick={() => inputs.onPick.value(item.value)}
      backgroundColor={lit.pipe(map(at => (at === index ? 'controlBackgroundHovered' : 'surface')))}
      borderRadius={6}
      paddingLeft={10}
      paddingRight={10}
      height={30}
      width={percent(100)}
      y="center"
      cursor="pointer">
      <row width={percent(100)} x="space-between" y="center" gap={16}>
        <text text={item.label} fontSize={13} color="text" />
        <text text={item.hint} fontSize={12} color="textMuted" fontFamily={MONO} />
      </row>
    </button>
  );
  return (
    <column
      role="listbox"
      label="Turn into"
      width={240}
      padding={4}
      gap={2}
      backgroundColor="surface"
      borderWidth={1}
      borderColor="border"
      borderRadius={8}>
      {items.pipe(
        map(list =>
          list.length === 0 ? [<text key="none" text="No matches" fontSize={13} color="textMuted" padding={8} />] : list.map(row)
        )
      )}
    </column>
  );
}

const HEADING_SIZES = [26, 21, 18, 16, 15, 14];
/** The source view's field, among the blocks' fields. */
const SOURCE = 'source';
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
    const formatting = command ? shortcutMark(event.key, shift) : null;
    if (command && shift && event.key.toLowerCase() === 'm') {
      handlers.toggleSource();
      event.preventDefault();
    } else if (command && event.key === 'Enter') {
      handlers.submit();
      event.preventDefault();
    } else if (!command && handlers.slashKey(id, event.key)) {
      event.preventDefault();
    } else if (formatting !== null) {
      handlers.format(id, formatting, model.start, model.end);
      event.preventDefault();
    } else if (command && (event.key === 'z' || event.key === 'Z')) {
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
    if (event.inputType === 'insertFromPaste' && event.currentTarget !== null) {
      // Markdown and HTML become blocks; a plain line of text is the field's.
      const model = editorFor(event.currentTarget);
      if (handlers.paste(id, model.start, model.end, event.data ?? '', event.html)) {
        event.preventDefault();
      }
      return;
    }
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
      placeholder={type === 'paragraph' ? inputs.context.value.placeholder : ''}
      label={label(current.value)}
      onKeyDown={onKeyDown}
      onBeforeInput={onBeforeInput}
      onFocus={() => handlers.focused(id)}
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
        <box width={percent(100)} x="stretch" padding={12} borderRadius={8} backgroundColor="surface">
          {field}
        </box>
      );
    default:
      // Stretched, so the field is the line's whole width: a press past
      // the end of a short line lands in it and puts the caret at its end,
      // as it does in any document.
      return (
        <box width={percent(100)} x="stretch" paddingTop={type === 'heading' ? 8 : 0}>
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

/** The formatting a shortcut asks for: Mod+B, I, E (code), K (link) and Shift+X (strikethrough). */
function shortcutMark(key: string, shift: boolean): Mark | 'link' | null {
  switch (key.toLowerCase()) {
    case 'b':
      return shift ? null : 'bold';
    case 'i':
      return shift ? null : 'italic';
    case 'e':
      return shift ? null : 'code';
    case 'k':
      return shift ? null : 'link';
    case 'x':
      return shift ? 'strike' : null;
    default:
      return null;
  }
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
