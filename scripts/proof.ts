/**
 * Phase 10's proof: the three budgets in the roadmap's "What 'done'
 * looks like", checked against the built app in headless Chrome, and
 * failing the build when one regresses.
 *
 * It drives the app the way a person does, through the shell's own
 * listeners: the board is scrolled with the wheel and a card dragged
 * with the pointer, the description is typed into key by key, and the
 * filter is changed from the filter bar's own controls. What it reads
 * back is what Gesso's proof panel records on `globalThis.trackerProof`
 * (the panel `/?proof` turns on), and the semantics mirror, which is
 * what a screen reader reads too.
 *
 *   pnpm proof
 *   SKIP_BUILD=1 pnpm proof     # against an existing dist/
 *   PROOF_KEEP=1 pnpm proof     # leave the browser up
 *
 * Following gesso-sheets' Phase 7 harness (`scripts/frame-budget.ts`
 * there).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { DevTools, findChrome, openPage, waitFor } from './lib/devtools.ts';

/** A frame at 60 Hz. */
const FRAME_MS = 1000 / 60;

/**
 * The budgets, as the roadmap states them.
 *
 * A frame is the render worker's own work per frame (`durationMs`),
 * not the gap between frames: a headless browser's pacing depends on
 * whatever else the machine is doing, and what the work costs is ours.
 * Keypress to glyph is from the shell receiving the key to the end of
 * the frame that drew it. A filter change is from the key that makes
 * it to the mirror saying the list has a new count, which happens only
 * after the frame that painted it.
 */
const BUDGET = {
  boardFrameP95Ms: FRAME_MS,
  keyToGlyphP95Ms: FRAME_MS,
  filterToRepaintMs: 100
};

/** The board the budget names has 10,000 issues; the Web team's has more. */
const BOARD_ISSUES = 10_000;
const NOTCHES = 150;
const TYPED = 'The export stalls at page three. ';

const PORT = Number(process.env.PROOF_PORT ?? '4327');
const DEVTOOLS_PORT = Number(process.env.PROOF_DEVTOOLS_PORT ?? '9327');
const SIZE: readonly [number, number] = [1280, 900];

interface ProofFrame {
  readonly at: number;
  readonly durationMs: number;
  readonly measured: number;
  readonly nodes: number;
  readonly inputLatencyMs: number | null;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function main(): Promise<void> {
  const failures: string[] = [];
  let preview: ChildProcess | undefined;
  let browser: ChildProcess | undefined;
  let devtools: DevTools | undefined;
  const profile = mkdtempSync(join(tmpdir(), 'tracker-proof-'));

  try {
    if (process.env.SKIP_BUILD === undefined) {
      await run('npx', ['vite', 'build']);
    }
    // Detached, so the whole group can be ended: `npx` is a wrapper
    // around the process that holds the port.
    preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
    const origin = `http://localhost:${PORT}`;
    await waitFor('the preview server', async () => ((await fetch(origin)).ok ? true : undefined), 30_000);

    ({ browser, devtools } = await openPage(findChrome(), {
      url: `${origin}/team/web/board?proof`,
      devtoolsPort: DEVTOOLS_PORT,
      windowSize: SIZE,
      profileDir: profile
    }));
    const page = devtools;

    // ------------------------------------------------------------
    // The board: 10,000 issues and more, scrolled and dragged
    // ------------------------------------------------------------
    await ready(page);
    const total = await waitFor(
      'the board',
      async () => {
        const text = await page.evaluate<string>(`[...document.querySelectorAll('[role="list"]')].map(el => el.getAttribute('aria-label') ?? '').join('|')`);
        const counts = [...text.matchAll(/([\d,]+) cards/g)].map(match => Number(match[1]!.replace(/,/g, '')));
        return counts.length >= 3 ? counts.reduce((sum, n) => sum + n, 0) : undefined;
      },
      30_000
    );
    console.log(`\n  the board holds ${total.toLocaleString('en-US')} issues`);
    if (total < BOARD_ISSUES) {
      failures.push(`the board holds ${total} issues, fewer than the ${BOARD_ISSUES} the budget is about`);
    }

    const backlog = await rect(page, `[role="list"][aria-label^="Backlog"]`);
    await reset(page);
    for (let notch = 0; notch < NOTCHES; notch++) {
      await page.wheel(backlog.x + backlog.width / 2, backlog.y + Math.min(backlog.height / 2, 300), 0, 100);
      await sleep(16);
    }
    await sleep(200);
    frameBudget('scrolling a board column', await frames(page), NOTCHES / 4, failures);

    // A drag across two columns, one move a frame, as a hand makes one.
    // A card on screen: the column has scrolled, and the rows mounted
    // above and below the window are in the mirror too.
    const { card, key } = await waitFor(
      'a card on screen',
      async () =>
        (await page.evaluate<{ card: Rect; key: string } | null>(
          `(() => {
             const column = document.querySelector('[role="list"][aria-label^="Backlog"]').getBoundingClientRect();
             for (const el of document.querySelectorAll('[role="list"][aria-label^="Backlog"] [role="listitem"]')) {
               const box = el.getBoundingClientRect();
               if (box.height > 0 && box.y >= column.y && box.y + box.height <= Math.min(column.y + column.height, innerHeight)) {
                 return { card: { x: box.x, y: box.y, width: box.width, height: box.height }, key: el.getAttribute('aria-label').split(' ')[0] };
               }
             }
             return null;
           })()`
        )) ?? undefined,
      10_000
    );
    const target = await rect(page, `[role="list"][aria-label^="In Progress"]`);
    const before = await columnCounts(page);
    await reset(page);
    await page.drag(
      [card.x + card.width / 2, card.y + card.height / 2],
      [target.x + target.width / 2, target.y + Math.min(target.height / 2, 300)],
      90
    );
    await sleep(300);
    frameBudget('dragging a card across the board', await frames(page), 30, failures);
    // The columns' counts, which say where the card went whatever rows
    // happen to be mounted.
    const after = await columnCounts(page);
    if (after['Backlog'] !== before['Backlog']! - 1 || after['In Progress'] !== before['In Progress']! + 1) {
      failures.push(`dragging ${key} to In Progress left the columns at ${JSON.stringify(after)} from ${JSON.stringify(before)}: the drop didn't happen`);
    }

    // ------------------------------------------------------------
    // Keypress to glyph, in a description and in 5,000 lines
    // ------------------------------------------------------------
    for (const [what, path, field] of [
      ['typing in a description', '/issue/WEB-12', `[role="region"][aria-label="Description"] [role="textbox"][aria-label="Paragraph"]`],
      ['typing in a 5,000-line document', '/editor/long', `[role="region"][aria-label="Long document"] [role="textbox"]`]
    ] as const) {
      await page.send('Page.navigate', { url: `${origin}${path}?proof` });
      await ready(page);
      const at = await rect(page, field);
      await page.click(at.x + Math.min(at.width - 4, 40), at.y + at.height / 2);
      await sleep(300);
      await reset(page);
      for (const char of TYPED) {
        await page.typeKey(char);
        // Apart enough that each key is its own frame, as typing is.
        await sleep(50);
      }
      await sleep(300);
      keyBudget(what, await frames(page), failures);
    }

    // ------------------------------------------------------------
    // A filter change across 50,000 issues, to the repainted list
    // ------------------------------------------------------------
    await page.send('Page.navigate', { url: `${origin}/team/web/list?proof` });
    await ready(page);
    await waitFor('the list', async () => ((await setSize(page)) !== null ? true : undefined), 30_000);
    const add = await rect(page, `[role="combobox"][aria-label="Add a filter"]`);
    await page.click(add.x + add.width / 2, add.y + add.height / 2);
    await sleep(150);
    await page.typeKey('s');
    await page.press('Enter', 13);
    await sleep(300);
    const timings: number[] = [];
    for (const query of ['todo', 'progress', 'done']) {
      for (const char of query) {
        await page.typeKey(char);
      }
      await sleep(300);
      timings.push(await timeRepaint(page, () => page.press('Enter', 13)));
    }
    const url = await page.evaluate<string>('location.search');
    console.log(`  filter changes: ${timings.map(ms => `${ms.toFixed(1)}ms`).join(', ')} (${url})`);
    if (!url.includes('status=')) {
      failures.push(`the status filter never reached the url (${url}): the filter changes didn't happen`);
    }
    for (const ms of timings) {
      check(failures, `a filter change repainted in ${ms.toFixed(1)}ms`, ms <= BUDGET.filterToRepaintMs, BUDGET.filterToRepaintMs);
    }

    if (process.env.PROOF_KEEP !== undefined) {
      console.log('\n  PROOF_KEEP is set: the browser stays up. Ctrl+C to end.');
      await new Promise(() => {});
    }
  } finally {
    devtools?.close();
    endGroup(browser);
    endGroup(preview);
    rmSync(profile, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\nProof failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nEvery budget held.');
}

/** Waits for the app's first frame, which is waiting for all of it to be up. */
async function ready(page: DevTools): Promise<void> {
  await waitFor('the first frame', async () => ((await page.evaluate<number>('globalThis.trackerProof?.frames().length ?? 0')) > 0 ? true : undefined), 30_000);
  // The seed's 50,000 issues, the overlay and the first query.
  await sleep(1500);
}

async function reset(page: DevTools): Promise<void> {
  await page.evaluate('globalThis.trackerProof.reset()');
}

function frames(page: DevTools): Promise<ProofFrame[]> {
  return page.evaluate<ProofFrame[]>('globalThis.trackerProof.frames()');
}

/** Where a mirror element stands over the canvas. */
async function rect(page: DevTools, selector: string): Promise<Rect> {
  return waitFor(
    selector,
    async () =>
      (await page.evaluate<Rect | null>(
        `(() => {
           const el = document.querySelector(${JSON.stringify(selector)});
           if (el === null) return null;
           const box = el.getBoundingClientRect();
           return box.width === 0 ? null : { x: box.x, y: box.y, width: box.width, height: box.height };
         })()`
      )) ?? undefined,
    20_000
  );
}

/** Each board column's count, from its name: "Backlog, 2507 cards". */
async function columnCounts(page: DevTools): Promise<Record<string, number>> {
  const labels = await page.evaluate<string[]>(`[...document.querySelectorAll('[role="list"]')].map(el => el.getAttribute('aria-label') ?? '')`);
  const counts: Record<string, number> = {};
  for (const label of labels) {
    const match = /^(.+), ([\d,]+) cards?$/.exec(label);
    if (match !== null) counts[match[1]!] = Number(match[2]!.replace(/,/g, ''));
  }
  return counts;
}

/** How many issues the list says it has, from its options' set size. */
function setSize(page: DevTools): Promise<string | null> {
  return page.evaluate<string | null>(`document.querySelector('[role="listbox"][aria-label="Issues"] [role="option"]')?.getAttribute('aria-setsize') ?? null`);
}

/**
 * From just before `act` to the mirror saying the list has a new count.
 * The mirror is written from the frame that painted it, so this is an
 * upper bound on the repaint; the clock starts a protocol round trip
 * early, which only makes it stricter.
 */
async function timeRepaint(page: DevTools, act: () => Promise<void>): Promise<number> {
  await page.evaluate(`(() => {
    const size = () => document.querySelector('[role="listbox"][aria-label="Issues"] [role="option"]')?.getAttribute('aria-setsize') ?? null;
    const before = size();
    globalThis.__proofStart = performance.now();
    globalThis.__proofDone = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (size() !== before) {
          observer.disconnect();
          resolve(performance.now() - globalThis.__proofStart);
        }
      });
      observer.observe(document.body, { subtree: true, attributes: true, childList: true });
      setTimeout(() => { observer.disconnect(); resolve(Infinity); }, 5000);
    });
  })()`);
  await act();
  return page.evaluate<number>('globalThis.__proofDone', true);
}

function frameBudget(what: string, recorded: readonly ProofFrame[], least: number, failures: string[]): void {
  if (recorded.length < least) {
    failures.push(`${what}: only ${recorded.length} frames, so it didn't happen`);
    return;
  }
  const durations = recorded.map(frame => frame.durationMs).sort((a, b) => a - b);
  const p95 = percentile(durations, 0.95);
  console.log(
    `  ${what}: ${recorded.length} frames · median ${percentile(durations, 0.5).toFixed(2)}ms · p95 ${p95.toFixed(2)}ms · ` +
      `worst ${durations.at(-1)!.toFixed(2)}ms · most re-measured ${Math.max(...recorded.map(frame => frame.measured))}`
  );
  check(failures, `${what}: p95 frame ${p95.toFixed(2)}ms`, p95 <= BUDGET.boardFrameP95Ms, BUDGET.boardFrameP95Ms);
}

function keyBudget(what: string, recorded: readonly ProofFrame[], failures: string[]): void {
  const latencies = recorded.map(frame => frame.inputLatencyMs).filter((ms): ms is number => ms !== null).sort((a, b) => a - b);
  if (latencies.length < TYPED.length / 2) {
    failures.push(`${what}: only ${latencies.length} frames answered ${TYPED.length} keys, so the typing didn't happen`);
    return;
  }
  const p95 = percentile(latencies, 0.95);
  // The frames' own work beside it: what's left of the latency is the
  // wait for the frame to start.
  const work = recorded.filter(frame => frame.inputLatencyMs !== null).map(frame => frame.durationMs).sort((a, b) => a - b);
  console.log(
    `  ${what}: ${latencies.length} keys · median ${percentile(latencies, 0.5).toFixed(2)}ms · p95 ${p95.toFixed(2)}ms · worst ${latencies.at(-1)!.toFixed(2)}ms` +
      ` (the frame's work: median ${percentile(work, 0.5).toFixed(2)}ms, p95 ${percentile(work, 0.95).toFixed(2)}ms)`
  );
  check(failures, `${what}: p95 keypress to glyph ${p95.toFixed(2)}ms`, p95 <= BUDGET.keyToGlyphP95Ms, BUDGET.keyToGlyphP95Ms);
}

function percentile(sorted: readonly number[], at: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))] ?? 0;
}

function check(failures: string[], described: string, ok: boolean, budget: number): void {
  if (!ok) {
    failures.push(`${described}, over the budget of ${budget.toFixed(1)}`);
  }
}

/** Ends a child and everything it started: `npx` and Chrome are both parents of what holds the resource. */
function endGroup(child: ChildProcess | undefined): void {
  if (child?.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: 'inherit' });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${String(code)}`))));
  });
}

await main();
