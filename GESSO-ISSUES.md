# Gesso issues found while building the tracker

These are problems in Gesso, or traps in using it, found by building on
it, and what happened to each.

**Where the fixes are:** committed to `main` in `../gesso`, one commit
per fix, `2c572e3` through `1dfb6c2`. Not yet pushed or released. Every
fix has a spec that fails without it, a changeset, and docs where
behavior changed. Gesso's full `pnpm check` passes with them: format,
lint, types, 4,461 tests, build, API reports and the docs build.

**How the tracker uses them:** `package.json` overrides every `gesso-*`
package with a link to `../gesso/packages/*`, so the tracker runs on that
checkout's source. Once the fixes are released, the overrides can go and
the tracker can go back to the published versions.

## Fixed

### 1. Typing cost grew with the document

**What:** in the editor spike's 5,000-line document, one keystroke
re-measured 9,000–13,000 nodes. It took 20–50 ms of layout in Chrome.
There were three separate causes, each a Gesso fix:

- **The measurement cache held two answers, and flex asked three
  questions.** A row with a flexible scroller of auto-height blocks
  measures each block unbounded (for the flex basis), at the final
  width, and at the stretched height. With two slots, the third always
  evicted one of the others. Layout records now keep three.
  Spec: `LayoutEngine.budget.spec.ts`, "re-measures a handful of nodes
  when one block of an auto-height document changes".
- **`SplitPane` moved its second pane on every keystroke.** The second
  pane's basis was its content, and the divider could shrink. When the
  content overflowed, the divider gave up a sliver that depended on the
  content's width, which shifted the pane by a fraction of a pixel and
  re-measured everything in it. The divider could end up 1 px wide. The
  divider is now fixed and the second pane's basis is zero. Spec:
  `Structure.spec.ts`, "keeps the second pane still when its content
  changes width".
- **A re-rendered parent replayed unchanged inputs into its children.**
  Inserting one block re-rendered the list, each block got its unchanged
  block back as a new value, and every block rebuilt its text runs: 12,912
  nodes re-measured for one Enter. Identical input values are no longer
  pushed again. Spec: `documentEditing.spec.tsx`, "does not replay an
  unchanged input into a child".

**Also fixed on the way:** `FrameMetrics.measured` repeated the last
layout's count for frames that ran no layout, so a caret blink looked
like a full re-measure. That made the earlier numbers here look worse
than they were.

**After:** a keystroke in the 5,000-line document re-measures 17 nodes
in Chrome (it was 13,415), and an Enter re-measures 488 (it was 12,912).
Layout still takes about 20 ms, because the column has 2,868 children
and its flex and placement passes visit each one, even when every visit
is a cache hit. That's inherent to one flat column of thousands of
children, so Phase 5 renders the document as nested chunks of blocks.
An edit then only reflows its own chunk.

### 2. Long plain text re-wrapped on every keystroke

**What:** a 5,000-line plain `<editabletext>` re-wrapped all of its text
on every keystroke: 19 ms of layout in node with the cheapest measurer.

**Fix:** text without runs is broken one hard line at a time, and each
line is cached, so an edit re-wraps only the line it changed. It now
takes about 3.5 ms. Text with `spans` keeps the old path. Spec:
`TextMeasurer.spec.ts`, "re-breaks only the hard line an edit changed",
which also checks the result against a cold measurer.

### 3. Auto-scroll ran only on the winning drop zone

**What:** a list whose rows were drop zones never auto-scrolled during a
drag, because only the deepest zone received `over()`.

**Fix:** drop zones get an optional `hover(state)`, called on every
accepting zone under the pointer, and `dropTarget` drives auto-scroll
from it. Spec: `drop.spec.ts`, "scrolls even when a row inside it is
the zone that would take the drop".

The tracker's board still makes each cell its only drop zone. With
fixed-height cards the drop index is exact arithmetic, and one zone per
cell draws one drop indicator.

### 4. The space bar couldn't be a shortcut

**What:** `shortcut({ keys: 'Space' })` never fired. The name was kept
as a literal key name, while the platform reports `' '`.

**Fix:** `Space` and `Spacebar` mean the space bar, and
`formatShortcut` prints it as `Space`. The board's pick-up and drop
use an ordinary `shortcut` again. Spec: `UiShortcuts.spec.ts`, "binds
the space bar by name".

### 5. `observeParams` returned null after a hot edit

**What:** the router found a route in the match by object identity.
After a hot edit, Vite could load a cyclic route table twice, the
screens held route objects the router had never seen, and every param
read null.

**Fix:** routes are matched by path as well as identity. Spec:
`RouterService.spec.ts`, "reads params for a copy of a route, as a hot
reload makes". The tracker still reads params through
`src/app/params.ts`, which keeps screens out of the import cycle.

### 6. A window resized back kept the other size

**What:** make the window taller, then shorter again, and the sidebar
stayed at the taller height: the theme switch at its foot went off
screen, and hit-testing followed the stale boxes. Growing could fail
the same way. Two holes in the measure memo:

- **A percentage's base wasn't part of the memo.** The sidebar pane is
  `height: 100%`, and was asked the same loose question under both
  windows, so it got the old height back. The base is now matched too,
  per axis, and only for a node with a percentage on that axis, so a
  `width: 100%` block isn't re-measured when its column's height moves.
- **A stack trusted its children's last answers.** When a stack's own
  measurement came from the memo, its children still held their answers
  to the other window's question, and the stack placed them at those
  sizes. Flex, grid and custom layouts already re-ask their children
  when placing them; the stack now does too, which costs nothing when
  the answer is remembered.

Spec: `LayoutEngine.measure.spec.ts`, "lays out a taller window at the
taller size" and "lays out a window resized back at the size it came
from". The 1,000-block editing budget still re-measures under 20 nodes.

### 7. The accessibility mirror could be scrolled out of line

**What:** clicking the sidebar's theme switch by its accessible element
clicked a project link instead. The mirror's sidebar region had been
scrolled 49 px by the browser, which scrolls even `overflow: hidden` to
reveal something it focuses (Tab, a screen reader, an automation tool).
Everything in it was described 49 px above where it is drawn. This is
also what looked like the theme preference not saving: the clicks never
reached the switch. Preferences save and restore correctly.

**Fix:** the mirror uses `overflow: clip`, which can't be scrolled.
Spec: `SemanticsMirror.spec.ts`, "clips rather than hides overflow".

## Not a bug, now documented

- **Undo in a multi-block editor.** `historyUndo` and `historyRedo`
  already arrive through `onBeforeInput` and can be cancelled, so an
  editor can own a document-level history today. A field clearing its
  own history when `value` changes from outside is correct. The
  text-editing docs now say both.
- **A scroll row's content set its parent's minimum width.** That's
  flexbox's automatic minimum, as in CSS, and `minWidth={0}` is the
  answer.

## Still open

- **Selection across blocks.** A selection can't span two editables, so
  you can't select two paragraphs or copy a heading with its list. This
  is a missing feature, not a defect, and the biggest piece of Gesso
  work left for Phase 5. Putting the whole document in one editable
  would give selection, undo and IME for free, but runs make every line
  of a paragraph as tall as its tallest run, so one heading would make
  every line heading-height. That's a pinned divergence from Chrome.
  Two ways forward:
  1. Line boxes of their own height in `ParagraphLayout`, then a
     single-editable editor.
  2. A selection model that spans editables, built on the existing
     cross-node selection for static text.
- **Percentage widths going stale in lazy rows.** Seen once in Phase 0
  and never reproduced since. A percentage-width row asked the same
  question after a resize got its old width back, which is exactly the
  hole fixed in 6, so this is very likely the same bug. Keep an eye out.
- **A `SegmentedControl` bound before it could see the theme's control
  tokens.** Seen once, during a hot-reload session, and not reproduced
  in isolation.
