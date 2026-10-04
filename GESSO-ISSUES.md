# Gesso issues found while building the tracker

These are problems in Gesso, or traps in using it, found by building on
it, and what happened to each.

**Where the fixes are:** committed to `main` in `../gesso`, one commit
per fix, `2c572e3` through `bf21b17` (another session's commits are
interleaved in the same range). All of them are released: `main` is
pushed through `99f67cc`, which is Gesso 0.5.1 (tag `v0.5.1`). Every
fix has a spec that fails without it, a changeset, and docs where
behavior changed. Gesso's full `pnpm check` passed through `f3a9544`:
format, lint, types, 4,487 tests, build, API reports and the docs
build. The ones since (16 to 57) were checked with their packages'
types, tests and API reports, because another session's unfinished work
in the same checkout fails the full check for now. After 51, the whole
test suite passed: 4,691 tests; after 55, 4,711; after 57, 4,754, with
the docs build; after 60, 4,765, with types, API reports and the docs
check.

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

### 13. A paste lost its HTML

**What:** the shell read only `text/plain`, so a copy from a web page or
a document reached the editor without its headings, lists and links.

**Fix:** the editing proxy and the semantics mirror read `text/html`
too, the paste message carries it to the worker, and it arrives as
`html` on the `insertFromPaste` `onBeforeInput`, on a `Paste` event and
on an editing group's edit (`b7c9514`). The editor converts it to
markdown. Specs: `EditingProxy.spec.ts`, `renderRoot.editing.spec.ts`
and `editingGroup.spec.tsx`. Checked in Chrome with a real
`ClipboardEvent` carrying HTML.

### 14. An editor couldn't act on a selection across blocks

**What:** Mod+B reaches the focused field first, and that field holds
only its part of a selection across blocks, so the editor couldn't
know what to make bold, and afterwards it could only leave a caret,
since nothing could set a selection across fields from code.

**Fix:** an editing group's `onSelectionChange` hears the selection
begin, move and end (`101ea8a`), and `EditingService.select(anchor,
focus)` sets one, in a field or across a group (`29a36ac`). The editor
formats every block the selection covers and leaves it selected, so a
second Mod+B takes the bold off again.

### 15. A worker couldn't load a chunk on demand

**What:** the HTML converter (parse5 and friends, 73 kB gzipped) was
imported dynamically so it would load only on the first HTML paste,
but the build inlined it into the render worker anyway. Vite builds
workers as IIFE by default, and an IIFE can't be split.

**Fix:** `gesso-vite-plugin` builds workers as ES modules, which is what
it constructs them as, unless the application chose a format
(`f3a9544`). The render worker went from 291 kB to 218 kB gzipped, and
the converter is a separate chunk. Checked in a production build: an
HTML paste loads it and lands.

### 16. A focused field lost its editing keys to app shortcuts

**What:** an app shortcut on a key a text field also uses (Mod+Z for
document undo, say) took the key even while a field was focused, so
the field's own undo, select all, and word and line moves could be
shadowed by whatever the app happened to bind.

**Fix:** the shortcut registry leaves a focused field the keys its
editing commands use (`84fe6d5`). Enter and plain typing still go to
shortcuts that ask for them.

### 17. An IME commit that matched the composition was dropped

**What:** composing over a selection across blocks (Japanese, say)
showed the composed text, but the commit compared it with the text as
the composition last showed it, found no change and reported nothing,
so the editor never heard the edit and the text was lost.

**Fix:** a commit is compared with the text from before the composition
began (`be3e274`), so it's reported whatever the composition showed on
the way.

### 18. A prop a re-render stopped declaring stayed on

**What:** a node rendered with `maxWidth` once and without it next time
kept the old `maxWidth`. Reconciliation set the props that were declared
and never took off the ones that weren't. In the editor, switching to
view source and back left the document 17 px narrower.

**Fix:** reconciliation remembers what each element declared and
removes what it stops declaring, through the same override cascade as
setting it (`4450c5c`), so a style or theme underneath shows through
again.

### 19. A copy could only be plain text

**What:** the shell's copy put `text/plain` on the clipboard and nothing
else, so the editor's copy pasted into a document or an email as raw
markdown, asterisks and all. Also, an editing group's `copyText` was
called every frame while a selection was up, since the shell's state is
rebuilt every frame.

**Fix:** an editing group's `copyHtml(start, end)` gives HTML for the
selection, across fields or inside one, and the shell's copy and cut
put it on the clipboard as `text/html` beside the text (`53b4c46`). What
a group makes of a selection is now cached until the selection or the
text under it changes. Checked in Chrome: a copy across a heading and a
paragraph carries both the markdown and `<h2>…</h2><p>…<strong>…`.

### 20. A highlight couldn't be announced without moving focus

**What:** a combobox keeps the caret in its field while the arrows walk
its list, so a screen reader has to be told which option is lit
without focus going there. Gesso had no `aria-activedescendant`.

**Fix:** an `activeDescendant` prop names that node; the mirror writes
`aria-activedescendant` on the element, and on the editing proxy (with
`aria-expanded`) while a field holds focus (`5a27b40`).

### 21. A component couldn't scroll a row into view without focusing it

**What:** keyboard focus scrolls its node into view, but a highlight
moving through a list doesn't move focus, so a long list didn't follow
it.

**Fix:** `ScrollService.scrollIntoView(node)` (`68b01e0`).

### 22. There was no combobox

**What:** the sidebar's assignee and labels need a list a person
searches by typing, one value or several. Gesso had `Select`, which is
read, not searched.

**Fix:** `Combobox` in `gesso-components` (`08a7c30`): filtering ranked
by label start, word start, anywhere, then keyword; `multiple` with
removable values; the highlight as `activeDescendant`. Then
`onQueryChange` and `filter={false}` (`5cae4b4`), so it can search a
list held elsewhere, which is how the issue page searches 50,000 issues
in the app worker. Two bugs found in the browser (`7e76ada`): the list
took the whole window's width, and a press that focused the field left
a caret, so typing added to the chosen name instead of replacing it.

### 23. There was no gridcell role

**What:** a calendar's days are the cells of an interactive grid, the
cells that can be `selected`. Gesso had `cell`, a table's.

**Fix:** `gridcell` (`5b3508d`).

### 24. There was no date picker

**What:** the due date.

**Fix:** `DatePicker` in `gesso-components` (`a0b5560`). The value is a
`YYYY-MM-DD` string, so no time zone puts it a day out. The calendar is
a dialog whose grid holds focus, with the day under the cursor as its
`activeDescendant`: arrows by day and week, PageUp and PageDown by month
(Shift, by year), Home and End, `min` and `max`.

### 25. A press between a document's lines went nowhere

**What:** in the issue page's description, a press in the editor's
padding or in the gap between two blocks focused nothing, so what was
typed next was lost. A document puts the caret on the nearest line.

**Fix:** a press inside an editing group that lands on none of its
fields goes to the nearest field by height (`d356006`); a press on a button
or anything with its own click listener is left to it. The tracker also
made each block the line's full width, so a press past the end of a
short line lands in that line.

### 26. A dialog's content was as narrow as its title

**What:** the New issue dialog asked for 600 pixels and drew its form in
the left half: the column inside `Dialog` sized itself to its content,
so fields asking for 100% got the width of the title.

**Fix:** the content is the dialog's width inside its padding
(`be422e9`).

### 27. A wrapping row was squeezed to one line

**What:** the filter bar wraps its controls onto a second line, and the
list below it (which grows) squeezed it back to one: its second line was
drawn over the list. A wrapping row's minimum height was its tallest
item's.

**Fix:** its minimum is all its lines at the width it's given, as in CSS
(`db1a6a1`).

### 28. A Combobox's chosen values had no names

**What:** a several-value Combobox named its chosen values when they
changed, so values from the url, set before the workspace's options had
arrived over the channel, showed as blank chips.

**Fix:** named from the current options (`a8ee079`). They also sit
inside the field's box now, before the text, rather than above it.

### 29. A url's lists read badly

**What:** the router encoded commas, so a filter link read
`status=todo%2Cdone`.

**Fix:** `formatUrl` encodes only what would change the parse
(`af33f45`).

### 30. Shortcuts read Ctrl on a Mac

**What:** the palette listed Cmd+K as Ctrl+K, on the grounds that the
render worker couldn't see the platform; it can, and the editing keys
already follow it.

**Fix:** shortcuts print as the platform writes them, `⇧⌘K` on a Mac,
and arrows as arrows (`6f03f61`).

### 31. Keys did nothing before the first click

**What:** keys reach the app through its canvas, which has focus only
after something puts it there; a page that loads with focus on its
body ignored `c` and Mod+K until a click.

**Fix:** `createApp({ pageKeys: true })` for an app that is the page
(`28f5b72`); the tracker and the create-gesso-app templates turn it on.

### 32. A capped scroll view was always its cap

**What:** the palette's list, and a Combobox's, were 280 to 420 pixels
of mostly empty panel when they held a few rows: a scroll view with a
`maxHeight` took the cap as its size, against the docs.

**Fix:** its content's size within its bounds (`1d61bae`).

### 33. A document was a Tab stop per paragraph

**What:** each block of the editor is a field of one editing group, and
Tab stopped at every one of them: a long description was two hundred
stops to get past.

**Fix:** an editing group is one Tab stop, entered at the field last
focused (`839011e`).

### 34. A hidden toolbar was still a run of Tab stops

**What:** the list's selection toolbar, hidden until something was
selected, kept its controls in the Tab order, where they were reached
and seen by no one.

**Fix:** a hidden (`visible={false}`) or disabled subtree has no stops,
and `focus()` refuses a node inside one (`2ce079c`).

### 35. Nothing said the person wanted more contrast

**What:** a canvas gets nothing from forced colours, and Gesso had
`withContrast` but no way to hear `prefers-contrast: more` or
`forced-colors: active`.

**Fix:** `ShellService.contrast`, `'high'` or `'standard'`, kept up to
date from the main thread in both shells (`62883e0`).

### 36. A flex base taken from content went stale

**What:** switching to the high-contrast theme halved the tracker's top
bar. The shell's main pane took its flex base from its content, read
while the list's `height: 100%` had nothing to resolve against; the
next measure resolved it and made the list's column a relayout
boundary, so when rows arrived the base was never read again. Any full
layout (a theme change, a resize) then gave a different answer from the
frame before. Found with the contrast check, and found to be the real
layout only once fixed: the tracker's fill regions now have
`flexBasis={0}`, as CSS's `flex: 1` would.

**Fix:** an item whose flex base is its content tells its subtree that
its content matters, and a scroll view without a size of its own passes
on its own answer (`1de054a`). The flex docs say what a content basis
costs.

### 37. A list couldn't say its selection is a set

**What:** the issue list selects rows with `x` and Shift, as a set, but
said `aria-multiselectable` nowhere, so Chrome took the row under the
active descendant to be the selected one and said so.

**Fix:** a `multiselectable` semantic state; a Combobox with `multiple`
uses it (`99538fa`).

### 38. Nothing could say which link is the current page

**What:** the sidebar marked the open page `selected`, which a screen
reader ignores on a link or a button. Gesso's own `Pagination` did the
same, and said in a comment that it was for want of anything better.

**Fix:** a `current` semantic state, mirrored as `aria-current`, and
`Pagination` uses it (`8fb3607`).

### 39. An application-wide Enter took the key from a focused button

**What:** Enter on the list's Clear selection opened the issue under the
cursor and cleared nothing. A keyboard press on a button is a default
action, applied after the key has been through the shortcut registry,
so the list's Enter shortcut got it first.

**Fix:** a bare Enter or Space isn't a shortcut while a button or link
has focus, unless it's that control's own (`7753bdc`).

### 40. Every issue opened scrolled to its bottom

**What:** the issue page focuses the whole issue when it opens, and
revealing a focused node moved its scroller by the nearer edge, which
for something taller than the window is its end. Found by the proof
harness, whose clicks on the description landed on a field that had
scrolled off the top.

**Fix:** a node bigger than its scroller is aligned by its start unless
it already fills the view, as CSSOM's `nearest` does (`8c4f475`).

### 41. A list's rows were laid out from the root as it scrolled

**What:** 36's fix marked the subtree of every flex item whose base is
its content, including a lone item that fills its line, whose base
can't change anything. The tracker's main region is one, so every row
its list mounted on a scroll was laid out from 13 levels up. Found by a
subagent looking into why scrolling felt laggy.

**Fix:** a line's only item that grows and shrinks to fill a definite
size, with a minimum of its own, doesn't make its content matter
(`ab0c1a6`).

### 42. Every frame clamped every text field's scroll

**What:** a frame that did any layout clamped the text scroll of every
editable ever laid out: in the 5,000-line document, five thousand clamps
for each keystroke, which kept the keypress budget at its edge.

**Fix:** only the fields measured or scrolled in the pass (`0f02fc2`).

### 43. A panel in an empty wrapper was never drawn

**What:** both renderers culled a node by its own box, and its subtree
with it, though a node that doesn't clip lets its children paint
anywhere. The tour, an absolute panel inside an empty wrapper at the
window's edge, was laid out and never drawn.

**Fix:** each record keeps a paint extent, the box grown by whatever
reaches past it, kept as boxes are written and shifted, and the cull
reads it (`427ce99`).

### 44. A colour that named nothing painted nothing, silently

**What:** the tracker used `surfaceRaised`, which no theme has, in six
places: a selected row, the sidebar's open page and its hover, the
assignee circles, the board's drop highlight and the tour. None of them
ever painted, and nothing said so.

**Fix:** it warns on the console, once a name (`2e3e56d`). Checked at
paint, since a theme may add tokens of its own.

### 45. The docs' Pagination example broke with 38

**What:** 38 moved Pagination to `current`, and the docs example's spec
still expected `selected`; the packages' suites passed, and that one
wasn't run.

**Fix:** the spec reads `current` (`ba99982`).

### 46. A trackpad flick stuttered, most of all as it slowed

**What:** Chrome on a Mac reports a trackpad's legacy `wheelDeltaY` as
three times its pixel delta, so a 40-pixel step read as a mouse wheel's
detent. Judged one event at a time, those steps were smoothed with a
spring and the steps around them applied at once. The scroll-lag
investigation had missed it: Chrome's injected test events always report
-120, so they all looked like a mouse.

**Fix:** once an event that doesn't look notched arrives, the wheel is
taken to be precise while events keep coming (`9341d31`). Checked by
specs against what Chrome reports; not yet watched on a Mac trackpad.

### 47. Scrolled text shimmered at the end of a flick

**What:** a trackpad's last steps are fractions of a pixel, and Canvas2D
drew the scrolled content at that exact offset, so text landed between
pixels and rasterised differently each frame.

**Fix:** both renderers draw scrolled content on a whole device pixel;
the offset keeps its fraction (`e73a5fc`).

### 48. `boxShadows` was never painted

**What:** the prop resolved into the paint state and neither renderer
drew it, so every theme's shadow scale did nothing. The tour panel used
a stronger border to stand off the list instead.

**Fix:** both renderers paint shadows as CSS `box-shadow` does: offset,
blur, spread, colour and `inset`, following the corner radius, with the
first shadow on top. A shadow's colour may be a palette name. A node is
culled only once its shadows are off screen too (`94a9f13`). The tour
panel now takes the theme's `shadows.large`. Checked by parity and
renderer specs; the WebGPU shader hasn't been compiled on a GPU yet.

### 49. Most of a trackpad flick was lost

**What:** each wheel step was added to the offset the last layout
settled on, so when two or more arrived between frames, as a trackpad's
always do, each overwrote the one before. A steady flick moved 1,210
pixels of the 2,500 asked for, unevenly.

**Fix:** a scroll starts from where the container is going (`5b59d13`).

### 50. A trackpad scrolled unevenly, then a beat behind

**What:** a trackpad sends on its own clock, so frames got one, two or
three of its steps: judder. Evening that out by pacing the steps behind
the input (`fb2a6d8`) made it smooth but, on a 120 Hz MacBook Pro, a
beat behind the hand.

**Fix:** each frame puts the page where the input will have reached when
the frame is shown, from the steps' velocity and timestamps, as a
browser does for its own scrolling (`0bef08b`).

### 51. A predicted flick sprang off the top

**What:** the prediction reached the top before the steps did, the
flick's last steps then found no room, and withdrawing the prediction
moved the list back down off the top. A slowing flick also stepped back
a pixel or two.

**Fix:** room is judged from where the steps have really taken the
list, each frame sets a clamped position, and a frame never moves
against the latest step (`50d1638`, docs `d3ab865`). Confirmed on the
MacBook Pro.

### 52. A copy couldn't say whether it worked

**What:** `ShellService.copyText` returned nothing, so "Copy link" could
only say "Copied" whether or not the browser had refused. And it does
refuse: a key pressed in the render worker reaches the window's
clipboard a message later, the async clipboard wants a focused document
(the preview pane's denies it outright), and the `execCommand` fallback
wants a gesture.

**Fix:** `copyText` returns a promise of whether the text landed. The
request carries an id, the shell answers with `clipboardResult`, and
`writeClipboard` reports what the async clipboard or the fallback did
(`dc7f199`). The tracker says "Couldn't copy the link" when it's false.

### 53. A toast couldn't offer Undo, and sat on the selection toolbar

**What:** the undo toast wants a button ("Moved 12 issues to Done",
Undo), and `Toast` had only the ✕. It was also always pinned 24 px off
the bottom left corner, which is on top of the list's selection
toolbar, exactly when a bulk change has just been made from it.

**Fix:** `action` and `onAction` draw a button that acts and closes the
toast (the timer closing it doesn't act); `placement` and `offset` move
the pin along the bottom edge (`ede6717`). The tracker's toast sits 72 px
in, like the tour panel.

### 54. A select's type-ahead also ran the page's shortcut

**What:** with the list's new `l` (labels) shortcut, typing `l` into the
open "Add a filter" list to reach Label opened the labels picker behind
it. `Select` used printable keys for type-ahead without consuming them,
so they bubbled on to the shortcut registry.

**Fix:** the open list keeps every printed character; the closed
trigger keeps a letter that picks an option and lets the rest through;
a key held with Mod, Ctrl or Alt is never type-ahead (`6d141a5`).

### 55. A toast mounted open drew in the light theme

**What:** the undo toast mounts a fresh `Toast`, already open, for each
change, so a screen reader hears each one. In the dark theme it came out
light. It opened from its placeholder's `ref` before that node had the
environment (the theme) it would be under: the builder called a ref as
it reached the prop, before a node built in that pass had its
environment seeded.

**Fix:** the toast waits for its placeholder (`e958805`), and a `ref` is
now handed its node after all its props are written and its environment
is seeded, before modifiers attach (`6d51def`).

### 56. A button couldn't be left out of the Tab order

**What:** the issue page's Previous and Next buttons sit above the
title, and the keyboard steps with j and k. As two ordinary tab stops
they stood between the issue (where focus starts) and its title.
`Button` had no way to stay pressable and focusable while Tab went past
it; the list's row checkboxes are bare `<button focusable={false}>`
elements for the same reason, without `Button`'s look.

**Fix:** `Button` takes `tabStop` (default true), passed to the element
(`d1fec43`). The step buttons set it false.

### 57. An editable's runs couldn't hide the markdown markers

**What:** an editable's `spans` must spell its text exactly, so the
editor kept `**`, `_`, backticks, `~~` and a link's `[`, `](url)` in
every block, drawn muted. Live preview (Obsidian, Typora) hides them
everywhere but the block being edited, and there was no way to keep a
character in the text without drawing it. Two smaller faults turned up
on the way: a field with runs measured its caret in its own font, so a
caret after a bold run sat short of the glyphs; and an IME composition
dropped a field's runs until the commit, since the application's runs
don't include the composing text.

**Fix:** a span can be `hidden` (`b502e0e`). Its characters stay in
the text (offsets, copy, undo, the semantics mirror) but take no room
and aren't drawn, and the caret steps over each stretch as one unit:
an arrow crosses one visible character and the markers in its way,
stopping on the side nearest where it started; Backspace after
`**bold**` deletes the `d` and keeps the markers; a press before the
boundary the markers sit at lands before them, one past it after; a
double click selects the word as drawn. Caret geometry is measured run
by run, and a composition moves the runs to make room instead of
dropping them. Docs: rich text, "Hidden runs".

A press that moved focus was then resolved against the layout focus
caused: the editor shows a block's markers when it takes focus, and a
click after `**bold** wo` landed between the closing asterisks. The
press's offset is now read before focus moves (`aa33728`).

The tracker's `inlineRuns` takes `hideMarkers`, and every block hides
its markers, the one with the caret too. A screen reader still hears the
markers, since the proxy holds the whole text; Phase 9.

### 58. A button put its content at the top left

**What:** the sidebar's links are 30 pixel `<button>`s holding a row of
text, and the row sat at the top of each one: off centre under every
hover and on the current page. A `<button>` stacked its children as a
`<box>` does, from its origin, while an HTML button and Gesso's own
`Button` centre their label. Nothing said so where it bit.

**Fix:** a `<button>` centres its children both ways unless `x` or `y`
says otherwise; a box still starts at the top left (`20ac739`). The
sidebar item says only `x="stretch"`, so its row spans it and the team
key reaches the far end. Docs: positioning and overlays, "Stacks align
their children".

### 59. A breakpoint was painted a frame late

**What:** stepping to the next issue flashed. The issue body's
`breakpoint` gives it 32 px of padding from 720 px of room and 16 below,
and a freshly mounted body was painted with 16 on its first frame and 32
on the next, so the page jumped 16 px right and down. A layout listener
(`breakpoint`, `sizeContainer` and so `Responsive`, `autoFocus`) hears
the boxes after layout and before paint, but what it wrote was laid out
on the next frame. Its own doc said so.

**Fix:** the runtime lays out again before it paints while the
listeners leave layout dirty, as a browser does after a `ResizeObserver`
callback: only what they dirtied, telling only the listeners whose boxes
then moved, bounded at 8 passes a frame with a console warning once
past it. A frame whose listeners write nothing that lays out runs one
pass. A reveal asked for from a listener (`autoFocus`'s) waits for the
final boxes. `FrameMetrics.layoutPasses` counts the passes (`979053a`).
Docs: responsive layout, "Listeners that change layout".

### 60. Focus from code always scrolled

**What:** the issue column takes focus as the page opens, so a screen
reader reads the issue. It's taller than the viewport and starts under
the page's padding, and every focus that isn't a click is revealed, 8 px
from the edge and from its top for a tall node, so each issue opened
scrolled to 8 or 24 px instead of 0. HTML has `element.focus({
preventScroll: true })` for this; Gesso had nothing.

**Fix:** `autoFocus({ preventScroll: true })`, and the same option on
`FocusService.focus` and `UiFocusManager.focus`; a key pressed later
doesn't reveal it either (`fac08c0`). The column uses it, and the issue
page's scroll view was already one per issue (`7110a76`), so each issue
stepped to starts at 0 and stays there. Spec: `shell.spec.tsx`, "starts
each issue stepped to at its top, drawn where it stays from its first
frame", which reads every frame from the step on. Docs: focus and
traps, "Autofocus".

### 61. A menu bar couldn't show which setting was on

**What:** found in gessosheet, not the tracker. Its View menu needed a
Light / Dark / Match system choice, and `MenuBar` drew every row as a
plain `menuitem`: no tick, and nothing a screen reader could read as
"checked". The only way round it was putting a tick in the label.

**Fix:** `MenuBar` takes `checkedOf`. True draws a tick, false leaves
its place empty, and undefined keeps a plain action. A menu with any
setting in it keeps a tick column on every row, and those rows are
`menuitemcheckbox` with the `checked` state (`28a971e`). Spec:
`MenuBar.spec.ts`. Docs: menu bar, "A setting gets a tick". Checked
with the components package's 466 tests, types, lint, format, the API
report and the docs check.
Released in 0.5.1, which gessosheet now depends on. Cutting it also
fixed two things on `main` that failed `pnpm check`: the dialog docs
example's spec still expected no margin after `3896cea` (`c75907a`), and
`anchorRect` had no property note, so the reference pages could not be
generated (`894efee`).

### 62. A popup couldn't open at a character in a field

**What:** the editor's mention and issue-reference lists belong under
the `@` or the key that opened them, in a paragraph as wide as the
page. Anchored to the block's field, the list sat at the field's left
edge whatever line the `@` was on. Gesso's documented way to put
something at the caret was a point worked out from
`EditingService.caretRectOf`, but a point doesn't follow its anchor, so
the list stayed behind when the issue page scrolled, and the caret's
rectangle was only the caret's, which moves on as the name is typed.

**Fix:** `anchorRect` on an overlay entry, on `useOverlay`'s options
and as a layout property: a rectangle in the anchor's own coordinates
that the entry is placed against, with the same flip and shift, and
followed through scrolling and layout like the anchor. It can be an
Observable, so the list moves with its word when the word wraps,
without opening again. `caretRectOf(node, offset)` answers for any
character (`6b71716`). Specs: `LayoutEngine.position.spec.ts`, "places
beside a part of its anchor, and follows it through scrolling";
`Overlays.spec.ts`, "opens under the character and moves with it,
without opening again"; `UiEditingController.selection.spec.ts` and
`EditingService.spec.ts` for the offset. In the tracker:
`MarkdownEditor.spec.tsx`, "opens under the @, wherever it is on the
line, and follows it when the word wraps". Docs: positioning and
overlays, "Anchored placement"; text input, "Putting something at the
caret". Checked with the core, framework and components tests (one
failure, in another session's unfinished dialog work), types, the API
reports and the docs check.

**Not Gesso's:** a press on an option's text started a canvas text
selection, which takes focus out of the field first, so the pick
never landed. Gesso's own lists opt out with `selectable={false}`, and
so does the editor's now.

### 63. A shortcut on `?` matched no keyboard

**What:** the keyboard shortcut sheet opens on `?`. Every layout types
`?` with Shift (Shift+/ in the US, Shift+ß in Germany, Shift+, in
France), and the registry compared Shift exactly, so `keys: '?'` never
fired. `'Shift+?'` worked only where Shift, not AltGr, typed it, and it
printed as `⇧?`.

**Fix:** a shortcut on punctuation, a digit or a symbol matches the
character the press produced: Shift isn't asked about, and a bare
symbol also takes AltGr (Control and Alt, or Option on a Mac). Letters
keep their Shift, so `Shift+L` and `l` stay apart (`db7040b`). Spec:
`UiShortcuts.spec.ts`, "matches a symbol on the character, however the
layout reaches it". In the tracker: `shell.spec.tsx`, "opens on ?
however the layout types it". Docs: shortcuts, "Symbols".

### 64. A help sheet couldn't draw a shortcut as keys, or say it

**What:** the registry's docs promise a help sheet, but a binding's
`display` is one joined string (`⇧⌘K`, `Ctrl+Shift+K`), which can't be
split back into caps (`Mod++`, `Space`), and its symbols aren't
something to name a row with: screen readers read `⌘` and `↓`
inconsistently, and skip `?` at their default verbosity.

**Fix:** `shortcutKeyCaps(steps)` gives the keys one at a time, one
array per press, and `formatShortcut` now joins those same pieces;
`describeShortcut(steps)` says them in words: `Shift Command K`,
`Down arrow`, `Question mark`, `g then d` (`13c096f`). Spec:
`UiShortcuts.spec.ts`, "splits a shortcut into key caps" and "says a
shortcut in words". Docs: shortcuts, "A help sheet".

### 65. Every reload after saving a service failed until a restart

**What:** adding state to `ShortcutsService` while the dev server ran
left the app showing "Service 'ShortcutsService' is not registered. A
different class of that name is registered", on every reload, until
the dev server restarted. The render worker entry accepts its
services' modules (the plugin's hot-replacement wiring), and Vite
leaves a module that accepts an update importing the module at the
timestamp from before the save, while every other importer moves on:
the reloaded page ran two copies of the service's module.

**Fix:** the plugin's `hotUpdate` marks the worker entry stale, softly,
when a module it accepts changes, so its imports move on too
(`4958693`). Spec: `vite-plugin/src/hmr.spec.ts`, against a real dev
server. Docs: hot module replacement, "Hand over the services the
module defines".

### 66. An open dialog kept the theme it opened with

**What:** pick Light and press `?` or `c` at once, and the dialog came
up dark over a light page: the theme comes back from the app worker a
moment later, and the overlay layer read the theme, text style and
content colour once, when an entry opened. A dialog open while the
system turned dark stayed light the same way.

**Fix:** the layer's entry box follows its environment node and
re-provides the three when they change. For that, a modifier host can
read and follow another node's environment (`environment(key, of?)`,
`onEnvironment(listener, of?)`), and the graph rebuilds in the same
frame an environment a listener dirtied while environments were being
rebuilt; before, that flag was swept up with the frame's dirty set and
the rebuild never ran (`581cf89`). Spec: `components/src/overlayTheme.spec.ts`.
Docs: positioning and overlays; modifiers.

### 67. A dialog wider than a phone ran off both sides

**What:** the shortcut sheet is 520 pixels wide; on a 375 pixel phone
its title and keys ran off both edges. `Dialog`'s `width` was its
width whatever the screen. The new issue dialog had the same problem.

**Fix:** the dialog's entry keeps a 16 pixel margin each side and the
dialog is at most as wide as the space between (`3896cea`). Spec:
`Dialog.spec.ts`, "fits a dialog wider than the screen inside it".
Docs: dialog.

Checked, for 63 to 67: the core, framework, components and vite-plugin
tests (3,934 across the first three), types, format, the API reports
and the docs check.

### 68. A dialog taller than the window ran off the top and the bottom

**What:** in a window shorter than about 560 pixels, the shortcut sheet
(a 420 pixel list under its filter) and the new issue form were taller
than the window, and `Dialog` centres its content however tall it is:
both ran off the top and the bottom, title and buttons with them.

**Fix:** as a browser's modal `<dialog>` does, a dialog is at most the
window less 16 pixels top and bottom. The title and description keep
their height and the body scrolls what doesn't fit; the body is a flex
column that scrolls, so content that may shrink is given the room there
is instead (`e4d2483`). The body keeps 4 pixels round its content, or
the title field's focus ring lost its top where the body clips
(`2a87a9d`). Spec: `Dialog.spec.ts`, "fits a dialog taller than the
screen inside it, scrolling the body under the title" and "gives
content that can shrink the room there is". Docs: dialog, "On a short
screen". In the tracker, the sheet's list keeps its 420 pixels where
there's room, so filtering doesn't move the dialog, and takes what's
left under the filter where there isn't (`minHeight={0}` on it and its
column). Specs: `shell.spec.tsx`, "the keyboard shortcut sheet in a
short window"; `NewIssueDialog.spec.tsx`, "the New issue dialog in a
short window", at 375×500 and 1280×500.

### 69. A panel pinned to the window's corner stayed where the corner was

**What:** found looking for 70. Opened at a phone's width and then
widened, the tour card stayed on the left, over the sidebar. It is
`position: absolute` from inside a column of the shell, against the
window. An absolute node was placed only when its parent was, and the
column kept its box when the window grew, so nothing placed the card
again.

**Fix:** the layout engine keeps the containing block each absolute
node was placed against and, after a pass in which a positioned node or
the root took a new box, places again the ones whose block changed
(`3b20918`). Spec: `GessoRuntime.resize.spec.ts`, "places a panel
pinned to the window's corner again, from inside a column that kept
its size", and the same for a positioned ancestor. Docs: positioning
and overlays, "What an absolute box is placed against". In the
tracker: `shell.spec.tsx`, "keeps the tour in the corner of a window
that was widened".

### 70. A dialog that can't be dismissed let presses through to the page

**What:** the report was the tour card drawn over an open dialog on a
narrow window. That part didn't reproduce, in specs or in Chrome at
320 to 375 pixels wide, with either dialog, before or after filing an
issue: the overlay layer is the app root's sibling at zIndex 1000, and
a zIndex only orders siblings, so the layer and everything in it draw
over the whole app, the tour included; hit testing reads the same
order. What is on screen on a phone is the tour card beside or below
the dialog, undimmed, since Gesso's backdrop has no colour. A press
there, though, reached the tour's buttons whenever the dialog wasn't
dismissible: a `Dialog` with `dismissible={false}` had no backdrop at
all. The tracker's two dialogs are dismissible, so their backdrops
took those presses already.

**Fix:** every `Dialog` has the backdrop; `dismissible` decides only
whether a press or a wheel on it closes the dialog. An overlay entry
takes `modal` for it (`684b59a`). Specs: `Dialog.spec.ts`, "covers a
positioned panel with a zIndex, and takes its presses", dismissible or
not, for a panel at zIndex 5000, painting and pressing both;
`Overlay.spec.ts`, "keeps the page from a press or a wheel beside a
modal entry". Docs: dialog, "`dismissible` is two things at once";
positioning and overlays, "A modal entry covers the whole page". In
the tracker: `shell.spec.tsx`, "the tour and a dialog on a narrow
window".

Checked, for 68 to 70: the core (2,453), framework (1,020) and
components (473) tests, the docs examples, types, lint, format, the
API reports and the docs check.

### 71. A split pane couldn't show one pane without unmounting the other

**What:** resizing across 720 pixels closed an open dialog: the New
issue dialog, the palette or the shortcut sheet. The shell built its
layout with `Responsive`, one arm a `SplitPane` of the sidebar and the
page, the other the page alone or the sidebar standing in for it, so
crossing the width built the page again. The dialogs are declared in
it, and a dialog closes with the component that declared it, which
reported the close and set the service's `open` to false; the palette,
mounted again with its service still open, threw. The list lost its
scroll and the focus too, and showing or hiding the sidebar with
Mod+\ did the same, a split swapped for the page alone. The shell's
fault, mostly: only the arrangement changes, so the tree shouldn't. But
Gesso gave it no way to keep a pane while not showing it: `SplitPane`
always drew both, and there is no `display: none`.

**Fix:** `SplitPane` takes `show`, `'both'`, `'first'` or `'second'`,
and can be a stream. The pane on its own takes the whole container; the
other is `visible: false` at no size, so it draws nothing, takes no
press or focus and isn't in the semantics tree, and keeps everything in
it (`feaf755`). Spec: `Structure.spec.ts`, "shows one pane alone,
keeping the other where it was" (nodes, scroll and focus). Docs: split
pane, "One pane at a time"; responsive, a paragraph on what a rebuilt
arm loses and what to use instead. In the tracker, the shell is one
`SplitPane` whose `show` follows the width, the drawer and the sidebar
preference, with the width read from a `UiContainerSizeSource` and
`containerBands` rather than `Responsive`; the sidebar is one instance
that shows its Close button and takes Escape only as the drawer, and is
as wide as its pane (it was 16 pixels short of it, and of a phone's
width as the drawer). Specs: `shell.spec.tsx`, "a window resized across
the narrow width": the New issue dialog with a half-typed title and the
caret in it, the palette with what was typed, the shortcut sheet, and
the list's scroll and focus through a resize both ways and the sidebar
hidden and shown.

### 72. A dialog didn't dim the page behind it

**What:** a dialog's backdrop (every `Dialog` has one since 70) had no
colour, so the page behind looked usable and the dialog sat flat on it.

**Fix:** palettes have a `scrim` token, a colour with alpha, as
`<dialog>::backdrop` and most design systems have one: the light ink,
rgb(17, 24, 39), at 40% in `lightColors`, black at 60% in `darkColors`,
and high contrast leaves it alone, since it's a ground (raised against
the dark background, black would have come out grey). An overlay
entry's backdrop is filled with it when the entry is `modal`, unless it
says `scrim: false`; a backdrop that only closes a menu or a list of
suggestions is never dimmed. The scrim is a child of the backdrop that
takes no presses, so its fade-in, at a dialog's pace and snapped under
reduced motion, never lets a press reach the page while it is at
opacity 0, and it takes its theme from the entry's environment, as the
content does. `Dialog` takes `scrim={false}`; its backdrop still keeps
the page from presses. A dialog doesn't animate out, so neither does
the scrim (`bf21b17`). Specs: `Dialog.spec.ts`, "Dialog's scrim" (its
colour in both palettes, the fade, reduced motion, the opt-out);
`Overlay.spec.ts`, "dims the page under a modal entry with the theme's
scrim, and under nothing else"; `UiContrast.spec.ts`, "leaves the
scrim ... as it was". Docs: dialog, "The page behind it is dimmed";
positioning and overlays, the `scrim` option; themes, the token list
(which lacked `placeholder` too). The docs' brand theme already had a
`scrim` of its own; it's a stock token now. The screenshot baselines
with an open dialog will differ, and weren't regenerated: they're
Linux Chrome's, from CI. In the tracker the palette, which is its own
overlay, says `modal`, so it's dimmed like the two dialogs. Spec:
`shell.spec.tsx`, "dims the page behind the New issue dialog, the
palette and the shortcut sheet, and not behind a menu".

Checked, for 71 and 72: the core, framework, components and docs tests
(4,435), types (and the docs'), lint, format, the API reports and the
docs check; in the tracker, its 1,651 tests and types, and in Chrome
at 800 and 400 pixels wide, light and dark.

### 68. A field couldn't name the list it opens, or say it suggests

**What:** the editor's mention and reference lists, and its slash menu,
make the block's field a combobox while they're open. ARIA's combobox
says which list it opens with `aria-controls` and that the list holds
suggestions with `aria-autocomplete`, and Gesso had neither: a screen
reader heard that something was expanded, not what. Gesso's own
`Combobox` didn't say them either.

**Fix:** two semantics properties. `controls` is a relation like
`activeDescendant`: the record holds the other node's id, and the
mirror, and the editing proxy for a focused field, write it as
`aria-controls` naming that record's element. `autocomplete` (`list`,
`inline` or `both`) is written as `aria-autocomplete`. `Combobox`'s
field controls its list while it's open, and is `list` (`77195a4`).
Specs: `UiSemanticsTree.spec.ts`, "names the list a combobox controls,
and says the list suggests"; `SemanticsMirror.spec.ts` and
`EditingProxy.spec.ts`; `Combobox.spec.ts`, "names the list it
controls while open, and says it suggests". In the tracker:
`MarkdownEditor.spec.tsx`, "makes the block a combobox while it's
open, its highlight the active option" and, for the slash menu, which
now goes through the same mechanism and says what it turned the block
into, "makes the paragraph a combobox while it's open, controlling the
menu, and says what it turned into". Docs: semantics, "The
properties"; the mirror; combobox, "Keyboard"; the properties
reference. Checked with the core, framework and components tests
(3,939), types, lint, format, the API reports and the docs check.

**Not Gesso's:** `@` counted as the start of a word for an issue key,
so typing `@WEB-` (a handle being typed) offered issues, and `@WEB-12`
was drawn as a reference. A key now starts only after a space, the
start of the block or opening punctuation, in what opens the list and
what's drawn as a chip alike; and the character that ends a mention can
start a reference, as in `@kim WEB-`. Spec: `MarkdownEditor.spec.tsx`,
"opens issues only where a key starts a word, not after @ or a letter";
`markdown.spec.ts` for the chips.

### Tooling

- **The accessibility check is a library** (`937f1d7`), so the tracker
  runs the same check the playground does. Its fixes, found running it
  on the tracker:
  - it refuses a port already in use (`8839b2b`), after it checked the
    wrong app;
  - a composite widget's items and disabled controls aren't Tab failures
    (`c5b8e25`);
  - a document's fields are reached as one (`0d64fbc`);
  - two controls with one name are told apart (`dd22046`);
  - a relation such as `activedescendant` prints the node it points at,
    not `undefined` (`b67b85b`).
- **A frame that throws fails the test** (`b43ada6`). `renderTest` and
  the framework's `mountRuntime` let the runtime abandon such a frame,
  as an application does, so a spec passed on a frame that never ran.
  It was hiding one fault: `mountRuntime`'s canvas mock answered
  `getTransform` with `undefined`, so any frame that drew a shadow threw.
  The mock keeps the transform now; `allowFrameErrors` is for a spec
  about the recovery itself. The tracker's 1,604 specs pass under it.
- **The focus docs** said there was no `:focus-visible` after describing
  it; the stale paragraph is gone (`238d96b`).
- **The API report churned on every build**: a short export such as
  `fr` showed as its bundler alias, and entries' imports kept their
  chunk's hash (`fa8deba`).

## Not a bug, now documented

- **Undo in a multi-block editor.** `historyUndo` and `historyRedo`
  already arrive through `onBeforeInput` and can be cancelled, so an
  editor can own a document-level history today. A field clearing its
  own history when `value` changes from outside is correct. The
  text-editing docs now say both.
- **A scroll row's content set its parent's minimum width.** That's
  flexbox's automatic minimum, as in CSS, and `minWidth={0}` is the
  answer.
- **A live region speaks its name.** The board's announcements were a
  `status` labelled "Board announcements", so every move was announced
  as those two words: a node's name is its `label` when it has one, and
  the mirror writes a live region's name as its content. The tracker's
  region has no label now. The accessibility docs still said there were
  no live regions at all; they describe them now (`3ddfcd2`).
- **`visible={false}` keeps its space.** It's CSS's `visibility:
  hidden`, not `display: none`; the tracker's selection toolbar left 53
  blank pixels under the list until it was taken out of the tree
  instead. The properties reference already says so.

## Still open

- **Percentage widths going stale in lazy rows.** Seen once in Phase 0
  and never reproduced since. A percentage-width row asked the same
  question after a resize got its old width back, which is exactly the
  hole fixed in 6, so this is very likely the same bug. Keep an eye out.
- **A `SegmentedControl` bound before it could see the theme's control
  tokens.** Seen once, during a hot-reload session, and not reproduced
  in isolation.
