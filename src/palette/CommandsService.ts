import { internalState } from 'gesso-framework';

/** Something the palette can do. */
export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  /** The heading it's listed under. */
  readonly group: string;
  /** Other words it answers to. */
  readonly keywords?: string;
  /** Its keyboard shortcut, as shown, when it has one. */
  readonly keys?: string;
  readonly run: () => void;
}

/**
 * Every command the palette lists, besides the keyboard shortcuts it
 * reads from the registry itself.
 *
 * A screen registers a provider while it's mounted: a function asked
 * for its commands when the palette opens, so what's offered is what
 * applies now (the issues selected now, the issue open now) and a
 * screen that's gone offers nothing.
 */
export class CommandsService {
  readonly open = internalState(false);
  private readonly providers = new Set<() => readonly PaletteCommand[]>();

  register(provider: () => readonly PaletteCommand[]): () => void {
    this.providers.add(provider);
    return () => this.providers.delete(provider);
  }

  commands(): PaletteCommand[] {
    return [...this.providers].flatMap(provider => provider());
  }
}
