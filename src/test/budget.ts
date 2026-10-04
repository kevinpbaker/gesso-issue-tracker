/**
 * A spec's time budget, in milliseconds, on the machine it's running on.
 *
 * The budgets are ROADMAP's, for a developer's machine. A CI runner is a
 * shared virtual machine about half as fast, and a budget kept exact there
 * fails on the runner rather than on the code: the 100 ms query came in at
 * 116 ms on GitHub's. So under CI the specs allow twice the time and still
 * catch a regression of the order that matters (a 100 ms answer taking
 * 400). The strict check is `pnpm proof`, which measures the real frames
 * in a browser against the same budgets.
 */
export function budget(ms: number): number {
  return process.env.CI === undefined ? ms : ms * 2;
}
