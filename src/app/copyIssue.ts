import { ShellService, type ComponentContext } from 'gesso-framework';

import { CommandsService } from '../palette/CommandsService';

export type CopyWhat = 'link' | 'key';

/**
 * An issue's address, whole, for pasting somewhere else.
 *
 * The issue route (`IssuePage` in `routes.tsx`, written out here because
 * the routes import the screens that import this) after the page's
 * origin. The render worker is served from the page's origin, so its
 * own `location` has it; and the tracker's urls are paths, not hashes,
 * so the route is the rest of the address.
 */
export function issueUrl(key: string, origin: string = globalThis.location?.origin ?? ''): string {
  return `${origin}/issue/${encodeURIComponent(key)}`;
}

/**
 * Copies an issue's link or key, then says whether it worked, through
 * the palette's notice. The shell answers whether the browser took it:
 * a key pressed in this worker reaches the window's clipboard a message
 * later, and a browser may refuse it then.
 */
export function useCopyIssue(ctx: ComponentContext): (key: string, what: CopyWhat) => void {
  const shell = ctx.inject(ShellService);
  const commands = ctx.inject(CommandsService);
  return (key, what) => {
    void shell.copyText(what === 'link' ? issueUrl(key) : key).then(copied => {
      if (copied) commands.say(what === 'link' ? `Copied ${key}'s link` : `Copied ${key}`);
      else commands.say(what === 'link' ? "Couldn't copy the link" : "Couldn't copy the key");
    });
  };
}
