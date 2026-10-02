import { UiShortcutRegistry } from 'gesso-core';

/**
 * The application's one shortcut registry, as a render-worker service.
 *
 * `shortcuts({ registry })` on the root is the only listener; every
 * screen registers its own keys with `shortcut(...)` for as long as it
 * exists, so a key belongs to the thing it acts on. Phase 8's palette
 * lists `registry.active(...)`.
 */
export class ShortcutsService {
  readonly registry = new UiShortcutRegistry();
}
