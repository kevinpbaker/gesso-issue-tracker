/**
 * What a screen reader would hear on every screen, checked.
 *
 * Gesso's accessibility check (`../gesso/scripts/lib/a11y.ts`, the one
 * Gesso gates its playground with) opens each route in headless Chrome,
 * reads the accessibility tree Chrome computes from the semantics
 * mirror, walks it with Tab, and writes a report per route to
 * `accessibility/`. The reports are committed: a change to what a
 * screen reader hears shows up as a diff, and they're the script a
 * VoiceOver or NVDA session follows. See ACCESSIBILITY.md.
 *
 *   pnpm check:a11y            # verify; fails on drift, an unnamed control, or a control Tab can't reach
 *   pnpm check:a11y:update     # rewrite the reports
 *
 * The workspace is the seed, every time: each route runs in a fresh
 * browser profile, so nothing saved by a previous run is in it.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runA11yChecks, type RouteCheck } from '../../gesso/scripts/lib/a11y.ts';

const here = dirname(fileURLToPath(import.meta.url));

const CHECKS: readonly RouteCheck[] = [
  {
    app: 'tracker',
    route: 'team-list',
    path: '/team/web/list',
    expect: [
      { role: 'navigation', name: 'Sidebar' },
      { role: 'button', name: 'New issue' },
      { role: 'textbox', name: 'Search issues' },
      { role: 'combobox', name: 'Group by' }
    ]
  },
  { app: 'tracker', route: 'team-board', path: '/team/web/board', expect: [{ role: 'button', name: 'New issue' }] },
  {
    app: 'tracker',
    route: 'issue',
    path: '/issue/WEB-12',
    expect: [
      { role: 'textbox', name: 'Title' },
      { role: 'combobox', name: 'Status' },
      { role: 'combobox', name: 'Assignee' }
    ],
    // Pointer targets beside the title; the keyboard steps with j and k,
    // and as tab stops they stood between the issue and its title.
    outOfTabOrder: [
      { role: 'button', name: 'Previous issue', keyboard: 'k' },
      { role: 'button', name: 'Next issue', keyboard: 'j' }
    ]
  },
  { app: 'tracker', route: 'my-issues', path: '/my-issues', expect: [{ role: 'button', name: 'New issue' }] },
  { app: 'tracker', route: 'view-active', path: '/view/active', expect: [{ role: 'button', name: 'New issue' }] },
  { app: 'tracker', route: 'editor', path: '/editor', expect: [{ role: 'region', name: 'Sample document' }] }
];

runA11yChecks({
  apps: { tracker: { root: join(here, '..'), port: 5197, url: path => path } },
  checks: CHECKS,
  reportDir: join(here, '..', 'accessibility'),
  update: process.argv.includes('--update'),
  updateCommand: 'pnpm check:a11y:update',
  reportNote: 'The workspace is the 50,000-issue seed, in a fresh browser profile, so nothing a previous run saved is in it.'
})
  .then(failures => {
    if (failures.length > 0) {
      throw new Error(`Accessibility check failed:\n  ${failures.join('\n  ')}`);
    }
    console.log('Accessibility ok.');
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
