# Roadmap

An issue tracker built on [Gesso](../gesso), in the style of Linear or
Jira: a board, a list, issue detail pages, filters, a command palette,
and a keyboard that can do everything the mouse can.

Like [gesso-logic](../gesso-logic) and [gesso-sheets](../gesso-sheets),
it exists to be evidence, but it tests a different claim. The logic
simulator showed that Gesso is fast, and the spreadsheet showed that it
can handle dense data. Neither one looks like the software most teams
build every day. A skeptic's real question about a canvas-rendered
framework is not "can it draw 8,000 gates?" It is "could I build my
day job in it?" Day-job software is forms, lists, text fields,
dropdowns, dialogs, keyboard shortcuts and screen readers, and those
are exactly the things a canvas is assumed to be bad at.

So this project is deliberately ordinary. If an issue tracker built on
Gesso feels at least as good as a DOM one, the "only good for exotic
demos" objection goes away. If it doesn't, this project should find
out precisely where and why.

**Status:** Phases 0 to 4 are done, and Phase 5 is under way.

- **Phase 1:** the app worker holds 50,000 seeded issues in one
  `IssueStore`, where every change is an undoable transaction, and saves
  what changed to IndexedDB.
- **Phase 2:** every screen has a real url, with a sidebar, a top bar,
  Back and Forward, `g` chords and Mod+Z, and light, dark and system
  themes.
- **Phase 3:** the list is grouped, sortable and collapsible, and driven
  from the keyboard (j/k, Shift to extend, x, Enter, Escape, Mod+A). Bulk
  edits apply to a selection the app worker holds as IDs, so it survives
  re-sorts. In Chrome, scrolling all 50,000 issues runs at 3.5 ms p95
  frame cost, and a bulk edit of 2,944 issues took four frames, the
  slowest 7.8 ms.
- **Phase 4:** the board has swimlanes by assignee or project
  (dropping a card in a lane reassigns it), a drop indicator, and a
  keyboard path for every drag: arrows or h/j/k/l to move a cursor,
  PageUp and PageDown between lanes, Space to pick up and drop, Escape
  to cancel. Each step is announced through a live region.
- **Phase 5, so far:** the editor (`src/editor/MarkdownEditor.tsx`)
  parses with micromark, so CommonMark is the parser's job, and keeps
  every block's source: an untouched document saves byte for byte, and
  an edit rewrites only the block it touched. That's checked on all 652
  CommonMark examples (two divergences pinned by name) and by property
  tests. It has one undo history for the whole document, in which a
  markdown shortcut is its own step. It renders in chunks. In a
  production build in Chrome, a keystroke in the 5,000-line document
  takes 7.5 to 10 ms a frame and an Enter 7 to 14 ms. Selection spans
  blocks (an editing group in Gesso): drag, Shift and the arrows, select
  all, typing or deleting over it, and copying it as markdown. Left:
  Mod+B/I/K, the slash menu, view source, pasting markdown and HTML,
  mentions as chips, and IME testing.
- **Gesso problems:** everything found so far is logged in
  [`GESSO-ISSUES.md`](GESSO-ISSUES.md).
- **Gesso fixes:** the problems the tracker found are fixed on Gesso's
  `main` (not yet released), and the tracker runs on it through
  `link:` overrides. Typing in the 5,000-line editor spike went from
  re-measuring 13,415 nodes per keystroke to 17. See
  [`GESSO-ISSUES.md`](GESSO-ISSUES.md).
- **Phase 5 needs:**
  - chunked block rendering, so a keystroke reflows one chunk and not a
    2,868-child column;
  - a document-level undo through `onBeforeInput`, which Gesso already
    supports;
  - cross-block selection, the one Gesso feature still missing.

`pnpm test` is 101 specs. Phase 5 is next.

---

## What "done" looks like

Someone who uses Linear or Jira every day can open the deployed app,
find an issue, change its status, rewrite its description, leave a
comment, file a new issue and build a saved filter, all without
reading any documentation and without noticing that there is no DOM.
They should be able to do all of it from the keyboard, and a screen
reader should be able to follow along.

Three numbers back that up, and CI enforces them in `pnpm proof`:

| Budget | Target |
| --- | --- |
| Board with 10,000 issues: scroll and drag frame time | under 16.7 ms at p95 |
| Keypress to visible character in the description editor | under one frame |
| Filter change across 50,000 issues to repainted list | under 100 ms |

---

## The thread split

| Thread | Owns |
| --- | --- |
| Shell (main) | the canvas, input forwarding, the IME and editing proxy, the clipboard, the accessibility mirror |
| App worker | the issue store, the query engine, the search index, persistence, the fake sync server |
| Render worker | every view, selection, focus, drag, and everything painted |

The render worker never holds the whole issue set. It sends the app
worker a query (a view, a filter, a sort and a visible window), and the
app worker publishes only that window as display-ready rows. This is
the same window-plus-overscan pattern that gesso-sheets measured in
its Phase 0, keyed by issue ID rather than by row index, so that
re-sorting does not invalidate every row.

---

## What Gesso may not have yet

These are suspected gaps, found by reading the component list, not by
building anything. Phase 0 should confirm or rule out each one. Gaps
that are real should be considered for upstreaming rather than worked
around, as gesso-sheets did with `LazySheet`.

- **A multi-paragraph rich text editor.** `<text spans>` styles runs
  within one paragraph, and `UiEditable` edits plain text with IME,
  undo and clipboard. An issue description needs paragraphs, lists,
  headings, code blocks, links and @mentions. This is the largest
  risk in the project, and Phase 5 builds it, backed by markdown.
- **A combobox with typeahead and multi-select.** You need one to pick
  assignees and labels. `Select` and `Chip` exist, but a filterable
  multi-select built from them has not been tried.
- **A date picker.** You need one for due dates and cycles. It is not
  in the component list.
- **Cross-container drag with auto-scroll.** `UiDragSession` already
  has typed payloads (`'board/card'` is its own docs example) and drop
  zones. Dragging a card into a column that has to scroll to reveal
  the drop slot, with the source list virtualized, is the part that
  hasn't been tested.
- **Variable-height virtualized lists.** Issue rows and comment
  threads vary in height. `LazyList` measures its rows; how it behaves
  with 50,000 rows under live re-sorting needs measuring.

**Out of scope, on purpose:** sign-in. The README says native form
controls bring autofill and password managers that a canvas cannot
match. The tracker opens straight into a seeded workspace as a fixed
demo user rather than pretending otherwise.

---

# Part One: the proof

## Phase 0: spike ✓

Prove the riskiest parts before building on them.

- Generate 10,000 issues in the app worker from a seeded generator.
- Render them as a five-column board with virtualized columns, and
  drag cards between columns.
- Build a throwaway multi-block editor on `UiEditable` that loads and
  saves a small markdown document, and find where it breaks:
  splitting and joining blocks, lists, IME composition across a block
  boundary, selection across blocks, and undo.
- Write the findings up in `PHASE0.md`, in the same shape as the
  sibling projects: what was measured, what broke, and what changes
  in the phases below.

**Exit criterion:** the board drags at 60 fps with 10,000 issues, and
`PHASE0.md` lists what `UiEditable` and the text engine need for the
Phase 5 editor, and which of those are engine changes to Gesso.

## Phase 1: the data model and the app worker ✓

- Define the types: `Workspace`, `Team`, `Project`, `Issue`, `User`,
  `Label`, `WorkflowState`, `Comment` and `ActivityEvent`. Issues get
  a team-prefixed key such as `WEB-1042`.
- Write a deterministic seed generator that produces 50,000 issues
  across 4 teams, with realistic titles, markdown descriptions,
  comment threads and history. The same seed always produces the same workspace, so
  tests and screenshots stay stable.
- Add a query engine in the app worker: filter, sort, group and
  window. It publishes rows keyed by issue ID.
- Persist with `persisted()` and `IndexedDbStorage`. Reloading the page
  keeps your edits, and a reset button restores the seed.
- Keep every mutation an event (`issue.statusChanged` and so on). One
  stream drives undo, the activity feed and later the fake sync.

**Exit criterion:** `pnpm test` covers the query engine on the full
50,000 issues, and a filter plus sort finishes inside the 100 ms
budget, measured in node.

## Phase 2: the app shell and routing ✓

- Build the layout: a sidebar (teams, projects, views, "My issues"), a
  top bar (breadcrumb, view switcher, filter button) and the main
  pane. Use `SplitPane` for the sidebar so it can be resized and
  collapsed.
- Add typed routes: `/team/:key/board`, `/team/:key/list`,
  `/issue/:key`, `/project/:id`, `/view/:id` and `/my-issues`. Back and forward
  should work, and every screen should be deep-linkable.
- Support light and dark themes through tokens, with no hex values in
  any view.

**Exit criterion:** every route is reachable by URL, by clicking and
by keyboard, and a reload restores the exact screen.

## Phase 3: the list view ✓

- Show a virtualized list of all 50,000 issues, grouped by status,
  assignee, priority or project, with collapsible groups.
- Each row shows the key, priority icon, title, labels as `Chip`s,
  assignee `Avatar` and the updated time.
- Add the keyboard model Linear users expect: `j`/`k` to move, `x` to
  select, `Shift` to extend, `Enter` to open, `Esc` to go back.
- Support multi-select with bulk actions: set status, assignee,
  priority or labels on 500 issues in one action, with one undo.

**Exit criterion:** scrolling the full list and bulk-editing 500
issues both stay within budget.

## Phase 4: the board view ✓

- Show columns per workflow state. Each column is virtualized and
  shows a count in its header.
- Drag cards between columns and reorder within a column. The board
  auto-scrolls near its edges, and drop slots stay accurate while
  columns scroll.
- Give every drag a keyboard equivalent: `Space` picks a card up, the
  arrow keys move it, `Space` drops it and `Esc` cancels. A live
  region announces each step.
- Add swimlanes grouped by assignee or project.

**Exit criterion:** every drag is undoable, and every drag has a
keyboard path with announcements that `pnpm check:a11y` can see.

## Phase 5: the markdown editor

A rich text editor drawn entirely by Gesso, with markdown as its
storage format. This is the centerpiece of the project: a canvas UI
that edits formatted text as well as a DOM editor does is the thing
skeptics assume can't be built. There is no `contenteditable` fallback
and no DOM overlay beyond the editing proxy the shell already uses for
IME.

**Markdown is the source of truth on disk, not in memory.** Every
description and comment is stored, synced, exported and diffed as
markdown text. While editing, the document is a tree of blocks
(paragraph, heading, list item, task item, quote, code block, rule)
holding inline runs (bold, italic, strikethrough, code, link,
mention). It's parsed from markdown on open and serialized back on
save. Editing the tree rather than the raw string keeps selection,
undo and IME tractable, while the stored markdown stays plain,
portable and readable in a `git diff`.

**The syntax:** CommonMark plus the GitHub extensions people already
type: task lists, strikethrough and autolinks. Mentions are written
`@username` and issue references `WEB-1042`; both render as chips
and stay plain text in the markdown. Tables and images are left for
Part Two.

**It edits like a rich text editor and reads like markdown:**

- What you see is formatted (headings are large, bold is bold), not
  raw syntax with highlighting.
- Markdown shortcuts convert as you type: `# ` makes a heading, `- `
  or `1. ` a list, `[ ] ` a task, `> ` a quote, three backticks a code
  block, and `**text**`, `_text_` or `` `text` `` style inline.
  Undoing right after a conversion restores the characters you typed.
- `Cmd+B`, `Cmd+I`, `Cmd+K` for links, `Tab` and `Shift+Tab` to nest
  lists, and a slash menu (`/`) for every block type.
- A "view source" toggle switches the same editor to raw markdown and
  back without losing the cursor position.
- Pasting markdown produces formatted text. Pasting HTML from another
  tab converts to the closest markdown. Copying puts markdown on the
  clipboard as plain text, plus HTML for rich targets.

**It never loses content.** Anything the parser doesn't understand
(a table, raw HTML, a footnote) becomes an opaque block that displays
as source and serializes back byte for byte. Opening and saving a
description without editing it must never change its markdown.

**Correctness is checked the way Gesso checks layout:**

- The parser runs against the CommonMark spec examples for the
  supported syntax, and every known divergence is pinned by name.
- Property-based round-trip tests: for generated documents,
  `parse(serialize(doc))` equals `doc`, and for generated markdown,
  `serialize(parse(md))` is stable after one pass.
- Every editing command (split, join, indent, toggle mark, convert
  block) has specs that run in node with no browser, through
  `gesso-testing`.

**Accessibility:** the editor exposes a multiline textbox, announces
the block type the cursor enters ("heading level 2", "task, not
done"), and lets screen reader users move by block. Phase 9 tests it
with VoiceOver and NVDA.

**Where it lives:** build it in this repo under `src/editor` with no
issue-tracker imports, so it can move to `gesso-components` as
`MarkdownEditor` once it's proven. The parser and serializer are
pure TypeScript with no Gesso dependency.

**Exit criterion:** someone can write a long bug report with headings,
nested lists, a checklist, a code block, a link and two @mentions,
entirely from the keyboard and including IME input. It saves to clean
markdown, reloads identically, survives a round trip through view
source, and keeps a keypress-to-glyph time under one frame in a
5,000-line document.

## Phase 6: issue detail

- Make the title editable in place.
- Use the Phase 5 editor for the description, saving to markdown on
  blur and after a short pause in typing.
- Add a properties sidebar: status, priority, assignee, labels,
  project, estimate and due date. This is where the combobox and date
  picker gaps get closed.
- Add comments (using the same editor), an activity feed, sub-issues
  and links to related issues.

**Exit criterion:** someone can write a long, formatted bug report
with a checklist, code block and two @mentions, entirely from the
keyboard, and it round-trips through a reload unchanged.

## Phase 7: creating issues and forms

- Open a "New issue" dialog with `c` from anywhere. It needs a title,
  description, team, status, assignee and labels, validated with
  `form.ts` and `validate.ts`.
- Save drafts automatically, so a half-written issue survives closing
  the dialog or reloading the page.
- Add "Create more" mode, which keeps the dialog open with sticky
  fields for filing several issues in a row.

**Exit criterion:** filing ten issues in a row with "Create more"
needs no mouse at all, and validation errors are announced.

## Phase 8: search, filters and the command palette

- Build `Cmd+K`, a command palette that does everything: jump to an
  issue, run any action, switch views and change any property of the
  selected issues. Fuzzy matching runs in the app worker.
- Add full-text search across titles, descriptions and comments,
  backed by an index the app worker builds and keeps up to date.
- Build the filter bar: chips you can combine for status, assignee,
  label, priority, project, dates and text. The filter is serialized
  into the URL.
- Let users save any filter, sort and grouping as a named view in the
  sidebar.

**Exit criterion:** a filter change across 50,000 issues repaints
within 100 ms, and every action in the app can be found in the
palette.

## Phase 9: accessibility, for real

This is the phase that makes the project worth showing to a skeptical
team.

- Run `pnpm check:a11y` against every route and commit the reports,
  as the Gesso playground does.
- Do a keyboard-only pass of the full workflow (triage, edit, file and
  filter) and fix every place focus gets lost.
- **Run a real screen reader.** Gesso's README says that no screen
  reader has been run against it yet. Do it here: complete the full
  workflow with VoiceOver on macOS and NVDA on Windows, and write up
  what worked and what didn't in `ACCESSIBILITY.md`.
- Check zoom, `prefers-reduced-motion` and high-contrast themes.

**Exit criterion:** a written VoiceOver and NVDA report exists, and
every blocking issue in it is fixed, here or upstream in Gesso.

## Phase 10: the proof harness

- Run `pnpm proof` in headless Chrome against the built app. It should
  drive real input (wheel, pointer, keys) and fail the build if any
  budget in "What 'done' looks like" regresses, following the
  gesso-sheets Phase 7 harness.
- Deploy to Vercel alongside the other two demos.
- Add a guided tour that someone seeing it for the first time can
  follow in two minutes.

**Exit criterion:** CI is green with every budget passing, and the app
is live.

---

# Part Two: a tracker rather than a demonstration

These come after Part One ships. Roughly in priority order:

1. **Fake multiplayer.** Simulated teammates in the app worker edit
   issues, comment and move cards, and changes arrive live while you
   work. Two browser tabs sync over `BroadcastChannel`. This tests
   live updates landing in the middle of an edit or a drag.
2. **Projects and roadmaps.** Show project progress and a horizontal
   timeline of projects and milestones. A Gantt-like view is a canvas
   problem, so Gesso should do this one well.
3. **Cycles and sprints.** Add cycle planning, a burndown chart and
   rolling over unfinished work.
4. **Notifications inbox.** Collect mentions, assignments and status
   changes, with read and unread state and snoozing.
5. **Import.** Load a CSV or Jira export through an OS file drop
   (`UiDragSession` already turns file drops into payloads), so people
   can see their own data in it.
6. **Mobile layout.** Touch drag, a single-column layout and
   swipe-to-triage. The README says mobile keyboards are a known
   weakness, so measure it honestly.
7. **More markdown.** Add tables, images (pasted or dropped into a
   description), and collaborative editing of one description by two
   people at once, using the fake sync server.
8. **Side-by-side with Angular.** Build the same list view with
   filters in Angular, then compare lines of code, bundle size and
   behavior with 50,000 issues. It's the comparison an Angular team
   will ask for.

---

## Things to decide before Phase 0

- **Whether to write the markdown parser or use one.** An existing
  CommonMark library such as `micromark`/`mdast` gets spec
  conformance for free, but it's built for one-shot parsing, not
  re-parsing a single block on every keystroke, and it may not
  preserve source exactly enough for byte-for-byte round trips.
  Writing a block-level parser for the supported subset is more work
  but fits the editor better. Phase 0 should try both on the spike.
- **Whether to vendor or publish.** Should the app depend on released
  `gesso-*` packages from npm (what the scaffold does today), or
  link to `../gesso` so engine gaps can be fixed in one commit? The
  sibling projects use released versions.
- **Seed data realism.** Generated titles that look fake will
  undermine the demo. It may be worth hand-writing a few hundred
  issue templates.
