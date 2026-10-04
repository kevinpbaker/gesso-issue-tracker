import { defer } from 'rxjs';
import { filter, map } from 'rxjs/operators';

import type { ComponentContext } from 'gesso-framework';

import { WorkspaceMeta } from '../app/WorkspaceContract';
import type { Completions } from '../editor/completion';
import { askedFor, References } from './ReferencesContract';

/**
 * What the tracker's editors complete: the workspace's people after
 * `@`, and after a team's key and a dash, that team's issues, matched
 * in the app worker. Handed to `MarkdownEditor` as its `completions`,
 * so the editor itself never reads a tracker channel.
 */
export function editorCompletions(ctx: ComponentContext): Completions {
  const workspace = ctx.channel(WorkspaceMeta);
  const references = ctx.channel(References);
  return {
    people: workspace.view.users.pipe(map(users => users.map(user => ({ handle: user.handle, name: user.name })))),
    references: {
      prefixes: workspace.view.teams.pipe(map(teams => teams.map(team => team.key))),
      // Asked when the editor subscribes, and answered by the first
      // result that names this question.
      find: (prefix, query) =>
        defer(() => {
          references.send.find({ prefix, query });
          return references.view.found.pipe(
            filter(found => found.asked === askedFor(prefix, query)),
            map(found => found.issues.map(issue => ({ value: issue.key, label: issue.key, detail: issue.title })))
          );
        })
    }
  };
}
