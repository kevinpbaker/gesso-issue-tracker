/**
 * The main thread's entire job: create the app and mount it.
 *
 * `gesso-vite-plugin` writes both worker constructions: `worker.ts`
 * for the render worker and `AppWorker.ts` for the application worker.
 *
 * With `?proof` in the url, `proofPanel` records every frame the
 * render worker reports on `window.trackerProof`, which is what the
 * Phase 0 measurements in PHASE0.md were read from.
 */
import { proofPanel } from 'gesso-devtools';
import { createApp } from 'gesso-framework';

const host = document.querySelector<HTMLElement>('#app');
if (host === null) {
  throw new Error('index.html has no #app element to mount into.');
}

const proof = new URLSearchParams(location.search).has('proof');
const panel = proof ? proofPanel(host, { global: 'trackerProof' }) : null;
// `path` mode: real urls, so a reload or a pasted link lands on the same screen.
// `pageKeys`: the tracker is the whole page, so `c` or Mod+K pressed
// before anything is clicked is the tracker's.
const app = createApp({ ...(panel?.options ?? {}), history: { mode: 'path' }, pageKeys: true });

panel?.attach(app);
app.mount(host);
