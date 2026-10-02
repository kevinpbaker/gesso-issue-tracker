# Gesso Issue Tracker

An issue tracker in the style of Linear or Jira, built on
[Gesso](../gesso) to show that a canvas-rendered app can handle
everyday software: forms, lists, a board, a markdown editor, the
keyboard and screen readers.

- [`ROADMAP.md`](ROADMAP.md) is the plan, phase by phase.
- [`PHASE0.md`](PHASE0.md) is what the first spike measured and found.
- [`GESSO-ISSUES.md`](GESSO-ISSUES.md) logs problems found in Gesso itself.

Gesso is linked from `../gesso` (see `pnpm.overrides` in
`package.json`), so that checkout has to sit next to this one.

```bash
pnpm install
pnpm dev                 # open /?proof to record frame times
pnpm test                # model, markdown and editor specs, in node
pnpm phase0:markdown     # our block parser against mdast
```

## Layout

| Path | What it is |
| --- | --- |
| `src/main.ts` | The main thread: create the app and mount it |
| `src/worker.ts` | The render worker: the root component and its channels |
| `src/AppWorker.ts` | The application worker: the workspace, served as channels |
| `src/model/` | Types, the seed, the `IssueStore`, the query engine, persistence |
| `src/app/` | Routes, the shell (sidebar, top bar, theme, shortcuts), preferences |
| `src/issues/` | The issue list: its channel, query service and screens |
| `src/board/` | The board: its channel, store and virtualized columns |
| `src/detail/` | The issue page and its channel |
| `src/editor/` | The markdown block model, inline styling, and the editor spike |
| `src/ui/` | Small shared pieces: nav links, the priority mark |
