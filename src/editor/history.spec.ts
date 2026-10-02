import { describe, expect, it } from 'vitest';

import { DocumentHistory, type DocumentState } from './history';
import { block, type Block } from './markdown';

const para = block('paragraph', '');
const state = (text: string, offset = text.length, blocks?: readonly Block[]): DocumentState => ({
  blocks: blocks ?? [{ ...para, text }],
  caret: { id: para.id, offset }
});

/** A history on a clock the spec moves by hand. */
function clocked() {
  let time = 0;
  const history = new DocumentHistory({ now: () => time, coalesceMs: 1000 });
  return { history, wait: (ms: number) => (time += ms) };
}

/** Types `text` one character at a time from `start`, recording each. */
function typeInto(history: DocumentHistory, start: DocumentState, text: string): DocumentState {
  let current = start;
  for (const char of text) {
    const next = state(current.blocks[0]!.text + char);
    history.record(current, next, 'typing');
    current = next;
  }
  return current;
}

describe('the document history', () => {
  it('undoes a run of typing as one step', () => {
    const { history } = clocked();
    const start = state('');
    typeInto(history, start, 'hello');
    expect(history.undo()).toBe(start);
    expect(history.canUndo).toBe(false);
  });

  it('starts a new step after a pause', () => {
    const { history, wait } = clocked();
    const start = state('');
    const first = typeInto(history, start, 'one');
    wait(1500);
    typeInto(history, first, ' two');
    expect(history.undo()).toBe(first);
    expect(history.undo()).toBe(start);
  });

  it('starts a new step when the caret moved by itself', () => {
    const { history } = clocked();
    const first = typeInto(history, state(''), 'ab');
    history.breakRun();
    typeInto(history, first, 'c');
    expect(history.undo()).toBe(first);
  });

  it('keeps typing and deleting apart', () => {
    const { history } = clocked();
    const typed = typeInto(history, state(''), 'abc');
    const deleted = state('ab');
    history.record(typed, deleted, 'deleting');
    expect(history.undo()).toBe(typed);
  });

  it('gives back what was typed when a markdown shortcut is undone', () => {
    const { history } = clocked();
    const typed = typeInto(history, state(''), '# ');
    const heading: DocumentState = { blocks: [{ ...para, type: 'heading', level: 1, text: '' }], caret: { id: para.id, offset: 0 } };
    history.record(typed, heading, 'shortcut');
    expect(history.undo()).toBe(typed);
    expect(history.redo()).toBe(heading);
  });

  it('never merges a structural edit, and forgets redo after a new edit', () => {
    const { history } = clocked();
    const a = state('a');
    const split: DocumentState = { blocks: [{ ...para, text: 'a' }, block('paragraph', '')], caret: null };
    history.record(a, split, 'structure');
    history.record(split, { ...split }, 'structure');
    history.undo();
    expect(history.canRedo).toBe(true);
    history.record(split, state('b'), 'typing');
    expect(history.canRedo).toBe(false);
  });

  it('keeps at most its limit of steps', () => {
    const history = new DocumentHistory({ limit: 3 });
    let current = state('');
    for (let i = 0; i < 10; i += 1) {
      const next = state(`${i}`);
      history.record(current, next, 'structure');
      current = next;
    }
    let undone = 0;
    while (history.undo() !== null) undone += 1;
    expect(undone).toBe(3);
  });
});
