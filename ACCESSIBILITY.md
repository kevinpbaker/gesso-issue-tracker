# Accessibility

The tracker draws everything on a canvas. A screen reader gets nothing
from that canvas. It reads Gesso's semantics mirror instead: a tree of
invisible DOM elements carrying ARIA, laid over the canvas. Fields are
read through a hidden textarea, the editing proxy. This page records
what has been checked, how, and what's still open.

**Status (October 2026):** the automated checks, the keyboard pass, and
the zoom, reduced-motion and contrast checks are done, and every
problem they found is fixed. **The VoiceOver and NVDA runs haven't
happened yet.** They need a person at a Mac and a Windows machine.
[The script](#screen-reader-test-script) below is written for that
session, with a place for the results. Phase 9's exit criterion is met
only once it has been run and every blocking problem it finds is fixed.

## Automated: what Chrome's accessibility tree says

`pnpm check:a11y` opens each route in headless Chrome and reads the
accessibility tree Chrome computes from the mirror, the same tree a
screen reader is handed. Then it walks the route with Tab. It fails on:
- a control with no name;
- a control Tab can't reach;
- a missing expected landmark or control;
- any difference from the committed report.

The reports are in [`accessibility/`](accessibility/), one per route:
the list, the board, an issue, My issues, a saved view and the editor.
A change to what a screen reader hears shows up as a diff in review.

What they confirm today:

- **Landmarks:** `navigation` "Sidebar", `banner` "Top bar", `main`
  "Main", `search` "Filter issues", and a `region` for the issue, its
  properties, sub-issues and links.
- **The list** is one Tab stop, a `listbox` "Issues" that is
  `multiselectable`. Its rows are `option`s named "WEB-27 Refactor image
  uploads in the mobile layout, Backlog, Dev Patel", with their position
  and the set's size (`posInSet`, `setSize` of all 12,606 issues, not
  just the rows on screen). The row under the cursor is the list's
  `activedescendant`, and `selected` means picked with `x`.
- **The board** is one Tab stop, a `group` "Board" whose description
  gives its keys. Its columns are lists and its cards list items. The
  card under the cursor is its `activedescendant`, and each move is
  announced in a polite live region.
- **The sidebar's entries** are `link`s, and the open page's has
  `aria-current`. Chrome's protocol doesn't report `aria-current` as a
  property, so the reports can't show it. It's in the DOM, and checked
  there.
- **Fields:** every control is named, task checkboxes by their task's
  text.

None of this proves a screen reader *speaks* it well. That's what the
script below is for.

## Keyboard

Every action in the workflow can be done from the keyboard alone:
triage, edit, file and filter. Focus starts where the page's content
is: the list on a list page, the board on a board, and the issue on an
issue page (Tab goes on to its title). The specs press each key the way
a person does.

| Where | Keys |
| --- | --- |
| Anywhere | `c` new issue · Mod+K command palette · Mod+Z / Mod+Shift+Z undo, redo · Mod+\ sidebar · `g m`, `g l`, `g b` go to my issues, the list, the board |
| The list | ↑ ↓ or `j` `k` move · `x` select · Shift+↑↓ or Shift+`J` `K` extend · Mod+A select all · Enter open · Escape clear the selection |
| The board | arrows or `h` `j` `k` `l` move · Page Up / Page Down between lanes · Space pick up, then put down · Escape put back · Enter open |
| The editor | Tab indents a list item; Escape, then Tab, moves on · Mod+B, I, E, K format · Mod+Shift+M markdown source · `/` in an empty line, block menu |
| A dialog or comment | Mod+Enter files or posts · Escape closes |

**Where focus used to get lost, and now doesn't.** A spec covers each:

- **Clear selection:** the toolbar leaves with the selection, so focus
  goes back to the list. Enter on that button also used to open the
  issue under the cursor; that was Gesso's, fixed upstream.
- **A filter's ×, or Clear the filters:** focus goes to "Add a filter".
- **An issue's sub-issue or link ×:** focus goes to that section's
  "Add" field.
- **The "Add" fields,** rebuilt empty after each pick: the new one takes
  focus.
- **Remove from parent:** focus goes to the Parent field.
- **The New issue dialog and the palette** hand focus back to whatever
  had it.

## Zoom and reflow

The canvas lays itself out in CSS pixels, so browser zoom makes the
layout narrower. It doesn't scale a picture. Checked in Chrome at 200%
and 400% of a 1280-pixel window (640 and 320 CSS pixels):

- **Below 720 pixels the sidebar moves behind a Menu button** in the top
  bar. It opens in the page's place and has the keyboard as it opens.
  Escape, Close or choosing a page brings the page back.
- **On an issue,** the properties go under the issue instead of beside
  it.
- **The top bar** wraps: where its controls don't fit beside the
  breadcrumb, they go onto a line under it, and the breadcrumb keeps
  room to be read and truncates past that.
- **On the list,** the summary row and the filter bar wrap their
  controls, and the page title truncates rather than running under the
  buttons. Each issue is two lines below 540 pixels: its key and title,
  then its status, when it changed and its labels.
- **The command palette and the dialogs** keep 16 pixels each side and
  are no wider than what's between. The New issue dialog's properties
  wrap, two to a line or one, with its buttons under the switch.
- **The board** scrolls sideways. A board is two-dimensional, which
  WCAG's reflow criterion exempts.

`src/app/shell.spec.tsx` checks the narrow layout at 320 pixels: that
each control of the top bar, the palette, the New issue dialog, a list
row and the filter bar is inside the window and clear of its
neighbours.

## Reduced motion

The tracker animates nothing of its own. Gesso's motion honours
`prefers-reduced-motion`:
- the dialog entrance;
- smooth scrolling, which with the preference jumps to where it would
  have ended up.

That's Gesso's `AnimationService` and `SmoothScroller`, covered by
Gesso's specs.

## Contrast

A canvas gets nothing from Windows' forced colours. So when the system
asks for more contrast, through `prefers-contrast: more` or
`forced-colors: active`, the tracker switches to the raised palette.
That uses Gesso's new `ShellService.contrast` with `withContrast`. It
was checked by emulating both in headless Chrome: borders and secondary
text get brighter, and nothing moves. Moving was a real bug, a Gesso
layout one, fixed upstream. `src/app/shell.spec.tsx` keeps it fixed.

## Screen reader test script

Run it twice:
- **VoiceOver** on macOS, in Safari and in Chrome;
- **NVDA** on Windows, in Chrome and in Firefox.

Start from a fresh profile, so the workspace is the seed:

```bash
pnpm install
pnpm dev
```

Open the printed address at `/team/web/list`. For each step, write what
was spoken under the step's results, and mark anything that stops the
task as **blocking**.

What each step expects is what the reports say Chrome hands the screen
reader. A gap between that and what's spoken is the finding.

### 1. Find your way around

1. List landmarks (VoiceOver rotor, Landmarks; NVDA, `D`). Expect:
   Sidebar (navigation), Top bar (banner), Main, Filter issues (search).
2. In the sidebar, list links. Expect "Web" to be announced as current.
3. Tab from the top of the page to the list. Expect it to read as
   "Issues, list box, multi-select" with the row it's on.

### 2. Triage in the list

1. With focus on the list, press ↓ three times. Expect each row read in
   full: key, title, status and assignee, with "n of 12,606".
2. Press `x`, then Shift+↓. Expect two rows announced as selected.
3. Tab to the "Selected issues" toolbar, set status to In Review, then
   press Enter on Clear. Expect focus back on the list, with no row
   selected.
4. Press Enter on a row. Expect the issue page, with focus on the issue
   region, read as its key and title.

Results:

| Reader | Browser | Step | What was spoken | Blocking? |
| --- | --- | --- | --- | --- |
| | | | | |

### 3. Edit an issue

1. Tab to the title, change it, press Enter. Expect the new title read
   back.
2. Set the status, the assignee (type part of a name), two labels and a
   due date. In each combobox, expect the highlighted option read as
   the arrows move, while focus stays in the field.
3. In the description, add a heading, a nested list and a checklist
   item. Expect each block's kind read as you enter it, and the
   checkbox named by its text.
4. Add a sub-issue by typing its key, then remove it with its ×. Expect
   focus on "Add a sub-issue" after each.
5. Write a comment and post it with Mod+Enter. Expect it read in the
   activity feed.

Results:

| Reader | Browser | Step | What was spoken | Blocking? |
| --- | --- | --- | --- | --- |
| | | | | |

### 4. File an issue

1. Press `c`. Expect "New issue, dialog" with focus in Title.
2. Fill in the title, description, team, status and assignee, then
   press Mod+Enter. Expect a toast, "Filed WEB-…: <title>", and focus
   back where it was.
3. Press `c`, then Escape. Expect the dialog closed and the draft kept.

Results:

| Reader | Browser | Step | What was spoken | Blocking? |
| --- | --- | --- | --- | --- |
| | | | | |

### 5. Filter and search

1. Tab to "Search issues", type `webhook`, and wait. Expect the
   summary's count to change. (It isn't a live region; check whether it
   should be.)
2. Add a status filter from "+ Filter" and choose two statuses. Expect
   each choice announced, then the list narrowed.
3. Remove it with its ×. Expect focus on "Add a filter".
4. Press Mod+K, type `board`, press Enter. Expect the palette's options
   read as you type, and the board opened.

Results:

| Reader | Browser | Step | What was spoken | Blocking? |
| --- | --- | --- | --- | --- |
| | | | | |

### 6. The board

1. Focus the board. Expect "Board, group" and its description of the
   keys.
2. Move with the arrows. Expect each card read.
3. Press Space, then → and Space. Expect, from the live region,
   "Picked up WEB-5…", then the column and position it's over, then
   "Dropped WEB-5 in Todo, position 1." Escape instead of the second
   Space should say it's back where it was.

Results:

| Reader | Browser | Step | What was spoken | Blocking? |
| --- | --- | --- | --- | --- |
| | | | | |

### Where trouble is most likely

These are the places a canvas app is most likely to differ from what
the tree promises. Watch them closely:

- **Browse mode (NVDA) and the VoiceOver cursor over a virtualized
  list.** Only the rows on screen exist in the mirror. Arrowing past the
  last one in browse mode may stop, and not scroll, where focus mode
  scrolls.
- **The editing proxy.** Typing, the caret, selection and IME in the
  title, description and comments. All of it goes through one hidden
  textarea, which is described as whichever field has focus.
- **Highlight rectangles.** The mirror's elements are positioned over
  the canvas. The VoiceOver cursor should frame what's drawn.
- **Live regions:** the board's moves, toasts and the editor's
  announcements.

## Findings

To be filled in from the runs above. Each blocking problem gets fixed
here or in Gesso, and recorded in [GESSO-ISSUES.md](GESSO-ISSUES.md) if
it's Gesso's.
