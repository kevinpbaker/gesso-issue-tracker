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
  /**
   * What the last command had to say, briefly: "Copied WEB-12's link".
   * The palette shows it and reads it out, wherever the command ran
   * from. Numbered, so saying the same thing twice says it twice.
   */
  readonly notice = internalState<{ readonly text: string; readonly round: number } | null>(null);
  private readonly providers = new Set<() => readonly PaletteCommand[]>();
  private rounds = 0;

  register(provider: () => readonly PaletteCommand[]): () => void {
    this.providers.add(provider);
    return () => this.providers.delete(provider);
  }

  commands(): PaletteCommand[] {
    return [...this.providers].flatMap(provider => provider());
  }

  say(text: string): void {
    this.rounds += 1;
    this.notice.value = { text, round: this.rounds };
  }
}
