import type { Observable } from 'rxjs';

import { filterCombobox } from 'gesso-components';

import { keyStart, wordStart } from './inline';

/**
 * Completing a mention or an issue reference as it's typed.
 *
 * `@` at the start of a word offers people, filtered by what follows
 * it; a team's key and a dash (`WEB-`) offers that team's issues, by
 * number or by title. Picking one writes what `inline.ts` draws as a
 * chip: `@ada`, `WEB-1042`.
 *
 * The editor knows nothing about people or issues. Whoever puts it on a
 * page hands it `Completions`, and without them nothing opens. Plain
 * logic here, so the rules are tested without a frame.
 */

/** Someone `@` can mention. */
export interface Mentionable {
  /** What's written after the `@`: lower case, as `inline.ts` reads it. */
  readonly handle: string;
  readonly name: string;
}

/** One thing to pick: what it inserts, and how it reads in the list. */
export interface Suggestion {
  readonly value: string;
  readonly label: string;
  /** A quieter second part: a handle, an issue's title. */
  readonly detail?: string;
}

/** What the editor can complete, from whoever puts it on a page. */
export interface Completions {
  /** Everyone `@` can mention. Matched here, as typed: a workspace has dozens, not thousands. */
  readonly people?: Observable<readonly Mentionable[]>;
  /** Issue references: the keys that start one, and the issues that match what follows. */
  readonly references?: {
    /** Team keys, `WEB`: typed with a dash after them, they open the list. */
    readonly prefixes: Observable<readonly string[]>;
    /**
     * The issues of the team with `prefix` matching `query`, the text
     * typed after its dash: a number to match keys, words to match
     * titles, nothing for the latest. Answered whenever it's ready, as
     * the matching runs elsewhere; each value is a full answer.
     */
    find(prefix: string, query: string): Observable<readonly Suggestion[]>;
  };
}

export type CompletionKind = 'mention' | 'reference';

/** Where a completion is: its kind, and the offset its trigger starts at. */
export interface Trigger {
  readonly kind: CompletionKind;
  readonly start: number;
  /** `@`, or the key and its dash: what the query follows. */
  readonly opener: string;
}

/** How many suggestions the list shows. */
export const SHOWN = 8;

/**
 * The completion the character just typed opens, if any: `@` at the
 * start of a word, or the dash after a team key where a key can start
 * (`wordStart` and `keyStart`, as `inline.ts` draws them: `@WEB-` is a
 * mention being typed, not a reference). Only a character typed opens
 * a list; text pasted or moved past does not.
 */
export function triggerAt(text: string, caret: number, prefixes: readonly string[]): Trigger | null {
  const typed = text[caret - 1];
  if (typed === '@' && wordStart(text, caret - 1)) {
    return { kind: 'mention', start: caret - 1, opener: '@' };
  }
  if (typed === '-') {
    const match = /([A-Z]{2,5})-$/.exec(text.slice(0, caret));
    if (match !== null && prefixes.includes(match[1]!) && keyStart(text, match.index)) {
      return { kind: 'reference', start: match.index, opener: match[0] };
    }
  }
  return null;
}

/**
 * What's typed after an open trigger, up to the caret, or null when the
 * completion no longer stands: the caret left it, or the trigger was
 * edited away.
 */
export function queryAfter(text: string, caret: number, trigger: Trigger): string | null {
  const from = trigger.start + trigger.opener.length;
  if (caret < from || text.slice(trigger.start, from) !== trigger.opener) {
    return null;
  }
  const query = text.slice(from, caret);
  return query.includes('\n') ? null : query;
}

/** The people a query matches, best first: a name's start, a word's, anywhere, then the handle. */
export function filterPeople(people: readonly Mentionable[], query: string): Suggestion[] {
  const options = people.map(person => ({ value: person.handle, label: person.name, detail: `@${person.handle}`, keywords: [person.handle] }));
  return filterCombobox(options, query.trim())
    .slice(0, SHOWN)
    .map(option => ({ value: option.value, label: option.label, detail: option.detail! }));
}

/**
 * Whether the list should close as the query stands: the last thing
 * typed was a space or punctuation and nothing matches, or a space came
 * straight after the `@`. A space alone doesn't end a mention, so `@Ada L` still finds Ada Lovelace, but
 * `@ada said ` closes at the space after "said". A reference is a
 * number or one word of a title, which nothing but a letter or a digit
 * continues, so it closes at the first anything else: `WEB-12 ` is a
 * reference written out.
 */
export function endsCompletion(kind: CompletionKind, query: string, matches: number): boolean {
  if (kind === 'reference') {
    return /[^A-Za-z0-9]/.test(query);
  }
  if (/^\s/.test(query)) {
    // `@ ` is an at sign, not a mention.
    return true;
  }
  return query !== '' && /[^\p{L}\p{N}]$/u.test(query) && matches === 0;
}

/** What a pick writes in place of the trigger and the query: `@ada `, `WEB-1042 `. */
export function inserted(kind: CompletionKind, value: string): string {
  return kind === 'mention' ? `@${value}` : value;
}
