import { afterEach, describe, expect, it } from 'vitest';

import { editorFor, percent, shortcut, shortcuts, UiShortcutRegistry } from 'gesso-core';
import { createComponent, type ComponentContext, type Inputs } from 'gesso-framework';
import { renderTest, textProperty, type Rendered } from 'gesso-testing';

import { bigDocument } from './bigDocument';

import { MarkdownEditor } from './MarkdownEditor';

/**
 * The editor, driven the way a person drives it: focus a block, press
 * keys, type. Everything is read back from the markdown the editor
 * would store, which is the only output that matters.
 *
 * "handles text typed in the same frame as a split" pins a bug the
 * Phase 0 spike had: text typed in the same instant as an Enter landed
 * in the wrong block, because the caret was tracked from selection
 * events and a caret placed by a focus request raises none. It is read
 * from the field's model at the moment of the key. See PHASE0.md §4.
 */

let ui: Rendered;
afterEach(() => ui?.unmount());

async function mount(markdown: string): Promise<void> {
  ui = renderTest(createComponent(MarkdownEditor, { value: markdown, showSource: true }), { width: 900, height: 600 });
  await ui.settle();
}

const source = (): string => textProperty(ui.getByLabel('Markdown source')) ?? '';

async function caretIn(label: string, index: number, offset: number | 'end'): Promise<void> {
  const field = ui.getAllByRole('textbox', { name: label })[index]!;
  ui.fireEvent.focus(field);
  const model = editorFor(field);
  const at = offset === 'end' ? model.text.length : offset;
  model.select(at, at);
  await ui.settle();
}

async function press(key: string, modifiers: { shift?: boolean; meta?: boolean } = {}): Promise<void> {
  ui.fireEvent.press(key, modifiers);
  await ui.settle();
}

async function type(text: string): Promise<void> {
  ui.fireEvent.type(text);
  await ui.settle();
}

describe('the markdown editor', () => {
  it('loads markdown and stores it unchanged', async () => {
    await mount('# Title\n\n- [ ] one\n- [x] two');
    expect(source()).toBe('# Title\n\n- [ ] one\n- [x] two');
  });

  it('splits a list item on Enter and continues the list', async () => {
    await mount('1. first\n2. second');
    await caretIn('List item', 0, 'end');
    await press('Enter');
    await type('between');
    expect(source()).toBe('1. first\n2. between\n3. second');
  });

  it('leaves a list on Enter in an empty item', async () => {
    await mount('- only');
    await caretIn('List item', 0, 'end');
    await press('Enter');
    await press('Enter');
    await type('after');
    expect(source()).toBe('- only\n\nafter');
  });

  it('turns typed markdown into blocks', async () => {
    await mount('start');
    await caretIn('Paragraph', 0, 'end');
    await press('Enter');
    await type('## ');
    await type('Heading');
    await press('Enter');
    await type('[ ] ');
    await type('task');
    expect(source()).toBe('start\n\n## Heading\n\n- [ ] task');
  });

  it('nests and un-nests list items with Tab', async () => {
    await mount('- a\n- b');
    await caretIn('List item', 1, 0);
    await press('Tab');
    expect(source()).toBe('- a\n  - b');
    await press('Tab', { shift: true });
    expect(source()).toBe('- a\n- b');
  });

  it('joins paragraphs on Backspace at the start, and keeps the caret at the seam', async () => {
    await mount('one\n\ntwo');
    await caretIn('Paragraph', 1, 0);
    await press('Backspace');
    await type('+');
    expect(source()).toBe('one+two');
  });

  it('demotes a heading to a paragraph before joining it', async () => {
    await mount('para\n\n## Head');
    await caretIn('Heading level 2', 0, 0);
    await press('Backspace');
    expect(source()).toBe('para\n\nHead');
    await press('Backspace');
    expect(source()).toBe('paraHead');
  });

  it('handles text typed in the same frame as a split, in the runtime', async () => {
    await mount('- a');
    await caretIn('List item', 0, 'end');
    // No settle between the Enter and the typing: both arrive before a frame.
    ui.fireEvent.press('Enter');
    ui.fireEvent.type('b');
    await ui.settle();
    expect(source()).toBe('- a\n- b');
  });

  it('undoes a split and the typing either side of it, a step at a time', async () => {
    await mount('one');
    await caretIn('Paragraph', 0, 'end');
    await type(' two');
    await press('Enter');
    await type('three');
    expect(source()).toBe('one two\n\nthree');
    await press('z', { meta: true });
    expect(source()).toBe('one two\n\n');
    await press('z', { meta: true });
    expect(source()).toBe('one two');
    await press('z', { meta: true });
    expect(source()).toBe('one');
    await press('z', { meta: true, shift: true });
    await press('z', { meta: true, shift: true });
    expect(source()).toBe('one two\n\n');
  });

  it('gives back the typed markdown when a shortcut it triggered is undone', async () => {
    await mount('start');
    await caretIn('Paragraph', 0, 'end');
    await press('Enter');
    await type('## ');
    expect(source()).toBe('start\n\n##');
    await press('z', { meta: true });
    expect(source()).toBe('start\n\n\\## ');
    expect(ui.getAllByRole('textbox', { name: 'Paragraph' })).toHaveLength(2);
  });

  it("keeps undo from the application's own shortcuts while it has focus", async () => {
    const registry = new UiShortcutRegistry();
    let appUndos = 0;
    function Host(_inputs: Inputs<{}>, _ctx: ComponentContext) {
      return (
        <box
          width={percent(100)}
          height={percent(100)}
          modifiers={[
            shortcuts({ registry }),
            shortcut({ registry, keys: 'Mod+Z', label: 'Undo', scoped: false, run: () => (appUndos += 1) })
          ]}>
          <MarkdownEditor value="one" showSource={true} />
        </box>
      );
    }
    ui = renderTest(createComponent(Host, {}), { width: 900, height: 600 });
    await ui.settle();
    await caretIn('Paragraph', 0, 'end');
    await type('!');
    await press('z', { meta: true });
    expect(source()).toBe('one');
    expect(appUndos).toBe(0);
  });

  it('writes an untouched document back exactly, including what it does not model', async () => {
    const odd = '#  Title  #\n\n| a | b |\n| - | - |\n\n* star\n\n  still star\n\n1) one\n';
    await mount(odd);
    expect(source()).toBe(odd);
  });

  it('edits a block it keeps as written', async () => {
    await mount('before\n\n| a | b |\n| - | - |\n\nafter');
    await caretIn('Markdown, as written', 0, 'end');
    await type('\n| 1 | 2 |');
    expect(source()).toBe('before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter');
  });

  it('reports every change as markdown', async () => {
    const changes: string[] = [];
    ui = renderTest(createComponent(MarkdownEditor, { value: '- a', onChange: (markdown: string) => changes.push(markdown) }), {
      width: 900,
      height: 600
    });
    await ui.settle();
    await caretIn('List item', 0, 'end');
    await press('Enter');
    await type('b');
    expect(changes.at(-1)).toBe('- a\n- b');
  });
});

describe('a selection across blocks', () => {
  it('replaces what it covers with what is typed, keeping the first block', async () => {
    await mount('# Title\n\nfirst paragraph\n\n- item');
    await caretIn('Heading level 1', 0, 2);
    await press('ArrowDown', { shift: true });
    await press('ArrowDown', { shift: true });
    await press('End', { shift: true });
    await type('X');
    expect(source()).toBe('# TiX');
  });

  it('joins on Backspace and splits on Enter, each one undo step', async () => {
    await mount('one two\n\nthree four');
    await caretIn('Paragraph', 0, 3);
    // Down keeps the column: from after "one" to after "thr".
    await press('ArrowDown', { shift: true });
    await press('Backspace');
    expect(source()).toBe('oneee four');
    await press('z', { meta: true });
    expect(source()).toBe('one two\n\nthree four');
    await caretIn('Paragraph', 0, 3);
    await press('ArrowDown', { shift: true });
    await press('Enter');
    expect(source()).toBe('one\n\nee four');
  });

  it('copies as markdown', async () => {
    await mount('## Steps\n\n1. first\n2. second');
    await caretIn('Heading level 2', 0, 0);
    await press('ArrowDown', { shift: true });
    await press('ArrowDown', { shift: true });
    await press('End', { shift: true });
    expect(ui.runtime.editingState?.text).toBe('## Steps\n\n1. first\n2. second');
  });

  it('moves between blocks with the arrows', async () => {
    await mount('one\n\ntwo');
    await caretIn('Paragraph', 0, 'end');
    // Down keeps the column, and "two" is as long as "one".
    await press('ArrowDown');
    await type('!');
    expect(source()).toBe('one\n\ntwo!');
    await press('Home');
    await press('ArrowLeft');
    await type('?');
    expect(source()).toBe('one?\n\ntwo!');
  });
});

describe('formatting', () => {
  async function selectIn(label: string, index: number, start: number, end: number): Promise<void> {
    const field = ui.getAllByRole('textbox', { name: label })[index]!;
    ui.fireEvent.focus(field);
    editorFor(field).select(start, end);
    await ui.settle();
  }

  it('makes the selection bold with Mod+B, and not bold again', async () => {
    await mount('make this bold');
    await selectIn('Paragraph', 0, 5, 9);
    await press('b', { meta: true });
    expect(source()).toBe('make **this** bold');
    await press('b', { meta: true });
    expect(source()).toBe('make this bold');
  });

  it('formats every block a selection across blocks covers', async () => {
    await mount('first line\n\nsecond line');
    await selectIn('Paragraph', 0, 6, 6);
    await press('ArrowDown', { shift: true });
    await press('i', { meta: true });
    expect(source()).toBe('first _line_\n\n_second_ line');
    // Still selected, so pressing it again takes it off.
    await press('i', { meta: true });
    expect(source()).toBe('first line\n\nsecond line');
  });

  it('makes a link with Mod+K and lets the address be typed', async () => {
    await mount('see the docs');
    await selectIn('Paragraph', 0, 8, 12);
    await press('k', { meta: true });
    await type('https://gesso.dev');
    expect(source()).toBe('see the [docs](https://gesso.dev)');
  });

  it('leaves code blocks alone', async () => {
    await mount('```\nconst a = 1;\n```');
    await selectIn('Code block', 0, 0, 5);
    await press('b', { meta: true });
    expect(source()).toBe('```\nconst a = 1;\n```');
  });
});

describe('pasting', () => {
  it('pastes markdown as blocks, splitting the paragraph it lands in', async () => {
    await mount('before after');
    await caretIn('Paragraph', 0, 7);
    ui.fireEvent.paste('one\n\n- two\n- three');
    await ui.settle();
    expect(source()).toBe('before one\n\n- two\n- threeafter');
  });

  it('converts pasted HTML to markdown', async () => {
    await mount('x');
    await caretIn('Paragraph', 0, 'end');
    ui.fireEvent.paste('Steps one', '<h2>Steps</h2><ol><li>one</li></ol>');
    await ui.settle();
    expect(source()).toBe('x\n\n## Steps\n\n1. one');
  });

  it('keeps inline formatting from pasted HTML in the same paragraph', async () => {
    await mount('ab');
    await caretIn('Paragraph', 0, 1);
    ui.fireEvent.paste('bold', '<b>bold</b>');
    await ui.settle();
    expect(source()).toBe('a**bold**b');
  });

  it('lets a field take a plain line of text, and makes a markdown line its block', async () => {
    await mount('ab');
    await caretIn('Paragraph', 0, 1);
    ui.fireEvent.paste('just words');
    await ui.settle();
    expect(source()).toBe('ajust wordsb');
    await caretIn('Paragraph', 0, 1);
    ui.fireEvent.paste('# Heading');
    await ui.settle();
    expect(source()).toBe('a\n\n# Headingjust wordsb');
  });

  it('pastes over a selection across blocks', async () => {
    await mount('one two\n\nthree four');
    await caretIn('Paragraph', 0, 3);
    await press('ArrowDown', { shift: true });
    ui.fireEvent.paste('X\n\nY');
    await ui.settle();
    expect(source()).toBe('oneX\n\nYee four');
  });
});

describe('a 5,000-line document', () => {
  it('re-measures a handful of nodes per keystroke, and a chunk for an Enter', async () => {
    ui = renderTest(createComponent(MarkdownEditor, { value: bigDocument() }), { width: 900, height: 700 });
    await ui.settle();
    const field = ui.getAllByRole('textbox', { name: 'Paragraph' })[40]!;
    ui.fireEvent.focus(field);
    editorFor(field).select(5, 5);
    await ui.settle();

    let before = ui.frames.length;
    ui.fireEvent.type('x');
    await ui.settle();
    const typing = Math.max(...ui.frames.slice(before).map(frame => frame.measured));

    before = ui.frames.length;
    ui.fireEvent.press('Enter');
    await ui.settle();
    const splitting = Math.max(...ui.frames.slice(before).map(frame => frame.measured));

    // eslint-disable-next-line no-console
    console.info(`[editor budget] keystroke measured ${typing}, Enter measured ${splitting}`);
    // In one flat column these were 17 and 488: an Enter re-measured every
    // block below it. In chunks, it re-measures the chunk it lands in.
    expect(typing).toBeLessThan(20);
    expect(splitting).toBeLessThan(40);
  });
});
