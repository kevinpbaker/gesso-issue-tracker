import { afterEach, describe, expect, it } from 'vitest';

import { editorFor } from 'gesso-core';
import { createComponent } from 'gesso-framework';
import { renderTest, textProperty, type Rendered } from 'gesso-testing';

import { EditorSpike } from './EditorSpike';

/**
 * The editor spike, driven the way a person drives it: focus a block,
 * press keys, type. Everything is read back from the markdown the
 * editor would store, which is the only output that matters.
 *
 * The last spec pins a bug the spike had and no longer has: text typed
 * in the same instant as an Enter landed in the wrong block, because
 * the caret was tracked from selection events and a caret placed by a
 * focus request raises none. It is read from the field's model at the
 * moment of the key now. See PHASE0.md §4.
 */

let ui: Rendered;
afterEach(() => ui?.unmount());

async function mount(markdown: string): Promise<void> {
  ui = renderTest(createComponent(EditorSpike, { markdown }), { width: 900, height: 600 });
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

async function press(key: string, modifiers: { shift?: boolean } = {}): Promise<void> {
  ui.fireEvent.press(key, modifiers);
  await ui.settle();
}

async function type(text: string): Promise<void> {
  ui.fireEvent.type(text);
  await ui.settle();
}

describe('the editor spike', () => {
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
});
