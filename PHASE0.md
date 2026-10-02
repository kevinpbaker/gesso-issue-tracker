# Phase 0: what the spike found

**The exit criterion is met, with one engine gap worked around.**
10,000 issues on a five-column board scroll and drag at 60 fps, with
every visible card arriving from the application worker. The editor
decision is made: **build the markdown editor in Gesso, on a block
model, with markdown as storage**. But it needs three things from the
engine before Phase 5 can meet its own exit criterion, and they're
listed in §4.

All numbers below were measured in Chrome (the Claude desktop app's
browser pane, on a Mac) through `proofPanel`'s frame recording
(`?proof` in the url, `window.trackerProof.frames()`), with input
driven by real pointer, wheel and keyboard events. They're from one
machine; the differences between them matter more than the decimals.

| Question | Answer |
| --- | --- |
| Does a 10,000-issue board scroll at 60 fps? | Yes. p95 frame cost 9.2 ms during a fast wheel scroll |
| Does a cross-column drag hold 60 fps? | Yes. p95 frame cost 2.5 ms, including auto-scroll |
| Does auto-scroll work during a drag? | Only after a workaround; see §2.1 |
| Can Gesso edit styled markdown in place? | Yes, with markers visible; see §3 |
| Can one editable per block make a document editor? | For the spike, yes. For Phase 5, no: cross-block selection and undo need engine work |
| Is typing in a 5,000-line document under one frame? | No. 23–36 ms per keystroke; see §4.3 |
| Our own parser or mdast? | Our own, with source preservation added; see §5 |

---

## 1. The board

`src/board/`. The app worker holds every issue and publishes only the
rows each column can see (`setWindow`), as a map keyed `state:index`,
following gesso-sheets' Phase 0 finding that maps diff far cheaper
than arrays. Each column is a `LazyColumn`; each card reads its own
slot.

| Run | Frame cost p50 | p95 | max | Frame gap p95 | Worst gap |
| --- | --- | --- | --- | --- | --- |
| Wheel scroll, 120 notches at ~6,000 px/s | 6.3 ms | 9.2 ms | 10.7 ms | 22 ms | 26 ms |
| Drag across two columns, then hold at the edge for 2 s of auto-scroll | 1.1 ms | 2.5 ms | 5.5 ms | 18 ms | 55 ms (an idle pause; see below) |

The scroll's frame gaps follow the cadence the test dispatched wheel
events at (a 16 ms timer), not the work, which never exceeded 11 ms.

**Correction, made in Phase 1:** the 55 ms "worst gap" during the drag
wasn't a slow frame. The test script paused for 50 ms before
releasing the pointer, and Gesso draws only when something changes,
so an idle pause reads as a gap between frames. Re-run three times
with 50,000 issues, the slowest frame took 5.9 ms, and every gap over
19 ms sat at that pause. Phase 1 gave each column its own revision
anyway, since it's cheaper, but it wasn't hiding a problem. Gap
numbers from demand-driven frames should always be read next to
frame cost.

What worked first time, with no workaround: virtualized columns, the
window round trip, `draggable` with `lift: true` carrying a card out of
one scrolling column and over another, typed drag payloads, the
accessibility mirror (the switch at the top is reachable as
`radio "Editor"`), and a board that scrolls sideways when five columns
don't fit (`<row overflow="scroll">`).

## 2. Gesso gaps the board found

Both are worth fixing upstream rather than working around for good.

### 2.1 Auto-scroll runs only on the deepest drop zone

`DropTarget.updateAutoScroll` in `core/src/modifiers/drop.ts` runs from
`over()`, which is called only on the zone that wins the hit test, and
the deepest accepting zone always wins. So a list whose rows are drop
zones never auto-scrolls during a drag: the pointer is always over a
row, never over the list.

**Worked around** by making each column the only drop zone and working
out the insertion index from the pointer
(`(y − box.y + scrollY) / CARD`), which is exact because cards are a
fixed height. It needed a small `Probe` modifier to read the column's
layout box from component code.

**Upstream fix:** run auto-scroll on every zone under the pointer that
asks for it (or on the scroll ancestors of the winning zone), not just
the winner. Variable-height lists, such as Phase 3's issue list, can't
use the arithmetic workaround.

### 2.2 Percentage widths inside lazy rows go stale on resize

A card sized `width={percent(100)}` inside a `LazyColumn` row kept its
old width when the window was resized. Cards overflowed the column or
stopped short, and titles didn't re-wrap. Rows mounted after the
resize were correct. Replacing the percentage with stretch alignment
(`x="stretch"` on the row wrapper) fixed it.

**Upstream fix:** a cross-axis size change on a lazy list should
invalidate its mounted rows' percentage resolution. Until then, the
rule for this project is no percentage sizes inside virtualized rows.

## 3. The editor: what works

`src/editor/`. One `<editabletext>` per block; markdown parsed into
blocks on load and serialized on every edit; the stored markdown shown
live beside it. Everything below is covered by
`EditorSpike.spec.tsx` (now `MarkdownEditor.spec.tsx`; the spike became
the Phase 5 editor), driven through the keyboard in node, and was
checked by hand in Chrome:

- **Inline formatting while typing.** `<editabletext spans>` styles
  ranges of the string being typed, so `**bold**`, `_italic_`,
  `` `code` ``, `~~strike~~`, links, `@mentions` and `WEB-1042`
  references render styled as you type them. Gesso requires the spans
  to spell the text exactly, so the markers stay visible, drawn muted.
  2,000 random strings confirm the styler always covers the source.
- **Markdown shortcuts.** `# `, `## `, `- `, `1. `, `[ ] `, `> `,
  three backticks and `---` convert the block as you type them.
- **Structure from the keyboard.** Enter splits a block and continues
  a list; Enter on an empty item leaves the list; Backspace at the
  start demotes a formatted block, then joins it to the one above;
  Tab and Shift+Tab nest list items; the arrows cross block
  boundaries.
- **Checkboxes** toggle, and the list numbering follows the structure.

## 4. The editor: what Phase 5 needs

### 4.1 Selection and undo are per block

Each block is its own editable with its own model, so:

- **A selection can't cross blocks.** Selecting two paragraphs, or
  copying a list together with its heading, is impossible.
- **Undo is per block, and structural edits wipe it.** Gesso's
  `EditableTextModel.replaceText` clears the undo and redo stacks
  whenever the `value` property changes from outside, which is exactly
  what a split or join does. So Cmd+Z after Enter doesn't rejoin the
  block, and the typing history of both halves is lost. (Found by
  reading the source; the spike doesn't try to undo structure.)

**What Phase 5 needs:** a document-level undo stack in the editor
(every edit, text or structural, as one transaction log, which also
drives Part Two's collaborative editing), and a way to suppress or
replace the per-field stack. Cross-block selection needs engine work,
most likely a multi-paragraph editable whose model holds a block list
rather than a string. That's the biggest single item, and it should
be scoped with Gesso before Phase 5 starts.

### 4.2 Focus has to be sent by hand

Gesso has `autoFocus` for a node that takes focus when it mounts. An
editor needs to send focus into a block that already exists, or into
one the current edit is creating and that has no node yet. The spike's
`FocusRequests` holds the request until the right block attaches or
hears it. It works, but it's 40 lines every editor would rewrite, and
it belongs upstream as a `focusRequest` modifier.

The spike had a bug here worth recording. It tracked the caret from
selection events, and a caret placed by a focus request raises none,
so text typed in the same instant as an Enter landed in the wrong
block. The fix is to read the caret from the field's model
(`editorFor(node)`) at the moment of the key. A spec in
`MarkdownEditor.spec.tsx` pins it.

### 4.3 Typing cost grows with the document

In a 5,257-line document (2,868 blocks), one keystroke cost:

| Version | Frame cost | Input latency | Layout | Semantics |
| --- | --- | --- | --- | --- |
| Children rebuilt on every edit | 33–53 ms | 56–81 ms | 25–40 ms | 7–11 ms |
| Children rebuilt only on structural change | 23–36 ms | 26–41 ms | 20–32 ms | 1.6–2.6 ms |

Rebuilding the child list only when blocks are added, removed,
reordered or retyped (and handing each block its own cell otherwise)
cut semantics by four times and latency by about half. That's now the
spike's design. But layout still re-measures the whole document on
every keystroke. The layout engine's own explanation says why:

```text
relayout: not a boundary · content stays inside · a change here is laid
          out from scroll-view 'root:0:0:0' (5 levels up)
```

Every block is under one auto-height column in one scroll view, so a
change anywhere is laid out from the top. Gesso's README says a text
edit deep in a 10,000-node page re-measures fewer than 20 nodes. That
holds when siblings keep their measurements, and here they don't.
Removing the percentage widths made it worse (19,610 nodes
re-measured instead of 9,571), so it isn't the §2.2 bug.

**What Phase 5 needs:** one of these, decided with Gesso:

1. **An engine fix:** siblings in a flex column keep their
   measurements when their constraints haven't changed, so one block
   growing re-places the rest without re-measuring them. This is the
   general fix, and every long form in the tracker benefits.
2. **Virtualize the editor:** blocks in a `LazyColumn`, which already
   handles variable heights through estimates and corrections. It's
   fast, but it makes cross-block selection (§4.1) harder still,
   because a selection can span unmounted blocks.

Mounting the 5,000-line document costs one 114 ms frame (layout
86 ms), which is acceptable for opening a document.

### 4.4 Not tested

- **IME composition across a block boundary.** There's no IME in the
  test harness. Phase 5 must test Japanese and Chinese input by hand,
  in particular pressing Enter mid-composition.
- **Hiding markers.** Spans can't drop characters, so hiding `**`
  means drawing the markers at near-zero size and teaching the caret
  to step over them. That's possible in principle but untried. Showing
  the markers muted, as the spike does, is a defensible design in its
  own right (Bear and Typora both offer it), so this is a product
  decision as much as an engine one.
- **Screen readers.** Each block is a labeled textbox ("Heading level
  2", "Task"), which is a reasonable start. A real reader comes in
  Phase 9.

## 5. Our parser or mdast

`scripts/phase0-markdown.ts` (`pnpm phase0:markdown`) compares the
spike's block parser (`src/editor/markdown.ts`) with
`mdast-util-from-markdown` and `mdast-util-to-markdown` (micromark,
with GFM), the latter configured to the same house style.

| | Own | mdast |
| --- | --- | --- |
| 300 seeded descriptions, unchanged after open and save | 300 / 300 | 300 / 300 |
| Full parse, 5,257 lines | 0.68 ms | 136 ms |
| Re-parse the one block a keystroke touched | 0.3 µs | 95 µs |
| Table with uneven columns, unchanged | yes | no |
| Setext heading, unchanged | yes, but parsed as a paragraph | no |
| Hard break (two trailing spaces), unchanged | yes | no |
| `*` bullets, `1)` lists, HTML block with a blank line, unchanged | no | no |

mdast is the more correct parser and the far slower one: it's built to
parse a document once, not to re-parse a block on every keystroke. Its
serializer also normalizes formatting, so the roadmap's rule that
opening and saving a description must never change it fails with mdast
on any markdown it didn't write.

**Decision:** keep our own block parser, and add **source
preservation** in Phase 5. Each block keeps the exact source text it
was parsed from, and the serializer writes an unedited block back
verbatim, so `* star` bullets someone else wrote stay stars. That
closes the "no" rows above without making the parser any smarter.
mdast remains an option for one-shot jobs where correctness matters
more than speed: importing a Jira export, or converting pasted HTML.
The CommonMark spec examples (roadmap Phase 5) will say how far our
parser is from correct.

## 6. What changes in the roadmap

- **Phase 4 (board):** keep the column-as-only-drop-zone design unless
  §2.1 is fixed upstream first. (A revision per column landed in
  Phase 1.)
- **Phase 3 (list):** variable-height rows can't use the drop-index
  arithmetic, so the list needs the §2.1 fix before its drag-to-reorder.
- **Phase 5 (editor):** starts from this spike's block model and
  structural-children design, and adds source preservation, a
  document-level undo log, and whichever of the §4.3 options is chosen.
  Cross-block selection (§4.1) is the long pole and should be scoped
  with Gesso first.
- **Upstream to Gesso, in priority order:**
  1. Sibling measurement caching (§4.3).
  2. A multi-block editing model (§4.1).
  3. Auto-scroll on non-winning zones (§2.1).
  4. Percentage widths in lazy rows (§2.2).
  5. A `focusRequest` modifier (§4.2).

## Reproducing this

```bash
pnpm dev
```

Open `http://localhost:5173/?proof`. Each frame is recorded on
`window.trackerProof`. "Board", "Editor" and "5,000 lines" at the top
switch between the spikes.

```bash
pnpm test
```

```bash
pnpm phase0:markdown
```

**Open question, not investigated:** the production build's main-thread
bundle is about 50 kB gzipped, against Gesso's stated 12.3 kB shell.
Some of that is `proofPanel`, which `main.ts` imports unconditionally;
the rest needs a look before anyone quotes the smaller number.
