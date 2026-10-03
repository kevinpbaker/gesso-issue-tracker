/**
 * Driving headless Chrome over the DevTools protocol.
 *
 * gesso-sheets' copy of the launcher in the Gesso repository, with a
 * drag and typing added. Kept here rather than reached for across the
 * checkout so that `pnpm proof` runs in CI, where there is no Gesso
 * working tree beside this one. Node has a `WebSocket` built
 * in, so driving the protocol directly costs a dependency less than a
 * browser-automation library and says exactly what it sends.
 *
 * Set `CHROME_BIN` to choose the binary.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME_CANDIDATES = [
  'google-chrome-stable',
  'google-chrome',
  'chromium',
  'chromium-browser',
  'chrome',
  // macOS keeps its browsers in app bundles, off the PATH.
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

export function findChrome(): string {
  const candidates = process.env.CHROME_BIN !== undefined ? [process.env.CHROME_BIN] : CHROME_CANDIDATES;
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next name
    }
  }
  throw new Error(`No Chrome binary found. Tried: ${candidates.join(', ')}. Set CHROME_BIN.`);
}

export async function waitFor<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result !== undefined) {
        return result;
      }
    } catch (error) {
      last = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.${last === undefined ? '' : ` Last: ${String(last)}`}`);
}

/** A minimal DevTools client: send a command, await its reply. */
export class DevTools {
  private nextId = 1;
  private readonly pending = new Map<number, (result: unknown) => void>();
  private readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id !== undefined) {
        const resolve = this.pending.get(message.id);
        this.pending.delete(message.id);
        resolve?.(message.error !== undefined ? new Error(message.error.message) : message.result);
      }
    });
  }

  static async connect(url: string): Promise<DevTools> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)), { once: true });
    });
    return new DevTools(socket);
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools ${method} did not reply within ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(id, result => {
        clearTimeout(timer);
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evaluates an expression and returns its value.
   *
   * `awaitPromise` matters for an async expression: without it the reply
   * carries the Promise itself and the value comes back undefined, which
   * reads exactly like a successful evaluation of nothing.
   */
  async evaluate<T>(expression: string, awaitPromise = false): Promise<T> {
    const reply = (await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise
    })) as {
      result: { value: T };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    };
    if (reply.exceptionDetails !== undefined) {
      const detail = reply.exceptionDetails;
      throw new Error(`Evaluation threw: ${detail.exception?.description ?? detail.text}`);
    }
    return reply.result.value;
  }

  /**
   * One wheel notch, as the platform delivers it.
   *
   * The whole point of the check: the page is scrolled by scrolling it,
   * through the shell's own listener and across the barrier, and not by
   * writing a scroll offset into the tree from the inside.
   */
  async wheel(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX,
      deltaY,
      pointerType: 'mouse'
    });
  }

  /** A press and release at a point, which is how a canvas button is pressed. */
  async click(x: number, y: number): Promise<void> {
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await this.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: 1,
        pointerType: 'mouse'
      });
    }
  }

  /** The second button, pressed and released: what opens a context menu. */
  async rightClick(x: number, y: number): Promise<void> {
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await this.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'right',
        buttons: type === 'mousePressed' ? 2 : 0,
        clickCount: 1,
        pointerType: 'mouse'
      });
    }
  }

  /**
   * A key, with the modifiers a shortcut is held with.
   *
   * `Alt=1, Ctrl=2, Meta=4, Shift=8`, added together, which is what
   * the protocol wants. A `rawKeyDown` rather than a `keyDown`
   * because an accelerator is about the key and not the character it
   * would type.
   */
  async press(key: string, code: number, modifiers = 0): Promise<void> {
    for (const type of ['rawKeyDown', 'keyUp'] as const) {
      await this.send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code, modifiers });
    }
  }

  /**
   * A press at one point, moves with the button held, and a release at
   * another: a drag, as the pointer makes one, one move per frame.
   */
  async drag(from: readonly [number, number], to: readonly [number, number], steps: number, stepMs = 16): Promise<void> {
    const mouse = (type: string, x: number, y: number, buttons: number) =>
      this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse' });
    await mouse('mousePressed', from[0], from[1], 1);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      await mouse('mouseMoved', from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, 1);
      await sleep(stepMs);
    }
    await mouse('mouseReleased', to[0], to[1], 0);
  }

  /**
   * Types one character as a key: down with its text, then up, which is
   * what a keyboard sends and what the shell's key path hears.
   * `Input.insertText` would skip that path, and its latency is the
   * thing being measured.
   */
  async typeKey(char: string): Promise<void> {
    const code = char.toUpperCase().charCodeAt(0);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char, unmodifiedText: char, windowsVirtualKeyCode: code });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char, windowsVirtualKeyCode: code });
  }

  close(): void {
    this.socket.close();
  }
}

export interface BrowserOptions {
  readonly url: string;
  readonly devtoolsPort: number;
  readonly windowSize: readonly [number, number];
  readonly profileDir: string;
}

/** Starts Chrome on `url` and returns the process with a client attached to its page. */
export async function openPage(
  chrome: string,
  options: BrowserOptions
): Promise<{ browser: ChildProcess; devtools: DevTools }> {
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      // Not `--disable-frame-rate-limit`: under it, Chrome drives a
      // software-composited worker's animation frames from the page's
      // main thread, so blocking the page stops a render worker that no
      // real browser would stop. gessologic's proof found it.
      `--window-size=${options.windowSize[0]},${options.windowSize[1]}`,
      `--user-data-dir=${options.profileDir}`,
      `--remote-debugging-port=${options.devtoolsPort}`,
      options.url
    ],
    { stdio: 'ignore' }
  );

  const origin = new URL(options.url).origin;
  const target = await waitFor(
    'the DevTools endpoint',
    async () => {
      const targets = (await (await fetch(`http://localhost:${options.devtoolsPort}/json`)).json()) as {
        type: string;
        url: string;
        webSocketDebuggerUrl: string;
      }[];
      return targets.find(t => t.type === 'page' && t.url.startsWith(origin));
    },
    20_000
  );
  return { browser, devtools: await DevTools.connect(target.webSocketDebuggerUrl) };
}
