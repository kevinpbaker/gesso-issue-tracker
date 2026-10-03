# Gesso issues found while building the tracker

These are problems in Gesso, or traps in using it, found by building on
it, and what happened to each.

**Where the fixes are:** committed to `main` in `../gesso`, one commit
per fix, `2c572e3` through `f0ade22`. Not yet pushed or released. Every
fix has a spec that fails without it, a changeset, and docs where
behavior changed. Gesso's full `pnpm check` passes with them: format,
lint, types, 4,480 tests, build, API reports and the docs build.

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

### 8. A markdown parser killed the render worker on start

**What:** importing micromark in the render worker failed with
"document is not defined". Its `decode-named-character-reference`
dependency has a browser build that uses the DOM, and Vite resolves
every dependency with the `browser` condition.

**Fix:** `gesso-vite-plugin` adds the `worker` condition ahead of
Vite's defaults; packages like this list their worker build first.
Spec: `vite-plugin/src/index.spec.ts`. Docs: the Vite plugin page.

### 9. Inserting a block re-placed everything below it

**What:** with the editor in chunks, typing re-measured a handful of
nodes, but an Enter in the 5,000-line document still took 18 ms of
layout. Boxes are absolute, so every block below the new one moved,
and each was placed again all the way down: 9,572 nodes.

**Fix:** a laid-out subtree that moves without changing size has its
boxes shifted by the same amount instead of being placed again. An
Enter now places 7 nodes. Spec: `LayoutEngine.budget.spec.ts`, "moves
the rows below an inserted row without placing them again".

### 10. The accessibility sweep visited every node on every layout

**What:** after any layout, the runtime worked out every mirrored
node's box to learn whether it was on screen: 4 to 24 ms of every
keystroke with 2,868 fields.

**Fix:** it walks down from the root and skips subtrees whose bounds
are off screen. With the editor in chunks, that's the visible chunks.
Spec: `GessoRuntime.semantics.spec.ts`, "looks only at what is on
screen".

### 11. Every structural change rebuilt the accessibility tree

**What:** any frame that added or removed a node rebuilt the whole
semantics tree, and every record whose index shifted went to the main
thread as an update. One Enter in the 5,000-line document sent 4,266
patches, and the mirror rewrote 4,266 elements.

**Fix:** the tree is rebuilt from the nearest record above the change.
Records nothing touched are taken back without being described, and an
untouched transparent subtree (a chunk) is taken back from what the
last walk remembered, without being walked. Index-only updates are
dropped when siblings kept their order, since a mirror that applies
removals and then adds in order has them in place already. The same
Enter sends 2 patches. Specs: `GessoRuntime.semantics.spec.ts`, "comes
out exactly as a full rebuild would" (300 random edits, checked against
a full rebuild and against what a mirror shows) and "keeps what it did
not touch".

Then the store itself: records kept by id with each record's children
in order, and an index worked out only for a record being sent, so an
insertion no longer renumbers everything after it (`5d67836`).

**After:** in a production build in Chrome, an Enter in the 5,000-line
document takes 7 to 14 ms a frame, with about 3 to 6 ms of semantics. It
was 15 to 18 ms with 7 to 10 ms of semantics, and 18 ms with 11 ms
before the scoped rebuild.

### 12. A selection couldn't leave its field

**What:** the editor is one field per block, and a selection couldn't
span two of them: no selecting two paragraphs, no copying a heading
with its list. Gesso's cross-node selection covered static text only.

**Fix:** editing groups (`f0ade22`). A container that sets
`editingGroup` makes the fields inside select as one. Arrows move
between fields at their edges (up and down keep the column), Shift
extends across them, as do a drag and Shift with a press, and select
all takes the group. Every field in the range draws its part. Edits
over such a selection go to the group's `onEdit` with both ends,
because joining blocks is the application's business; the editor joins
the first block's head to the last block's tail, keeping the first
block's type. While a selection spans fields, the shell's editing proxy
holds the selected text, so the browser's own copy and cut work, and
the editor's `copyText` makes that markdown. Specs:
`editingGroup.spec.tsx` in Gesso, and "a selection across blocks" in
`MarkdownEditor.spec.tsx`. Checked by hand in Chrome: a drag across
three list items, typing over it, and undoing back.

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

- **Percentage widths going stale in lazy rows.** Seen once in Phase 0
  and never reproduced since. A percentage-width row asked the same
  question after a resize got its old width back, which is exactly the
  hole fixed in 6, so this is very likely the same bug. Keep an eye out.
- **A `SegmentedControl` bound before it could see the theme's control
  tokens.** Seen once, during a hot-reload session, and not reproduced
  in isolation.
