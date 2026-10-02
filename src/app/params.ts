import type { Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import type { RouterService } from 'gesso-framework';

/**
 * The current match's params, by name, without naming a route.
 *
 * `router.observeParams(SomeRoute)` would do, but it needs the route
 * object, so every screen would import the route table that imports
 * every screen. Reading the leaf's params from `router.match` keeps the
 * screens out of that cycle. (The cycle also broke `observeParams` under
 * Vite's hot reload until Gesso matched routes by path; see
 * GESSO-ISSUES.md.)
 */
export function routeParam(router: RouterService, name: string): Observable<string | null> {
  return router.match.pipe(
    map(match => {
      const value = match?.params[name];
      return value === undefined ? null : decodeURIComponent(value);
    }),
    distinctUntilChanged()
  );
}
