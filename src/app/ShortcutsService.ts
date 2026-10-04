import { UiShortcutRegistry } from 'gesso-core';
import { internalState } from 'gesso-framework';

/**
 * The application's one shortcut registry, as a render-worker service.
 *
 * `shortcuts({ registry })` on the root is the only listener; every
 * screen registers its own keys with `shortcut(...)` for as long as it
 * exists, so a key belongs to the thing it acts on. Phase 8's palette
 * lists `registry.active(...)`, and so does the sheet `?` opens.
 */
export class ShortcutsService {
  readonly registry = new UiShortcutRegistry();
  /** Whether the keyboard shortcut sheet is open. */
  readonly sheetOpen = internalState(false);
}

/** The sheet's name: its shortcut's label, its palette command and its top bar button. */
export const KEYBOARD_SHORTCUTS = 'Keyboard shortcuts';
