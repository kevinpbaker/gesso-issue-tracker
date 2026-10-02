/**
 * Inline markdown, as runs of style over the source string.
 *
 * The runs cover the string exactly, character for character, because
 * an editable's `spans` are presentation over the text being typed and
 * Gesso draws the field unstyled when they disagree. So the markers
 * stay in the text: `**bold**` is drawn as two muted asterisks, a bold
 * word and two more. Hiding them is a Phase 5 question; see PHASE0.md.
 *
 * No framework import: a run is plain data that happens to have the
 * shape of `UiTextSpan`.
 */

export interface InlineRun {
  readonly text: string;
  readonly fontWeight?: number;
  readonly fontStyle?: 'italic';
  readonly fontFamily?: string;
  readonly textDecoration?: 'line-through' | 'underline';
  readonly color?: string;
  readonly backgroundColor?: string;
}

type Style = Omit<InlineRun, 'text'>;

interface Token {
  readonly pattern: RegExp;
  /** The style of each capture group, in order: open marker, content, close marker, … */
  readonly styles: readonly Style[];
}

const MARK: Style = { color: 'textMuted' };
const CODE_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const TOKENS: readonly Token[] = [
  { pattern: /(`)([^`]+)(`)/y, styles: [MARK, { fontFamily: CODE_FAMILY, backgroundColor: 'surface' }, MARK] },
  { pattern: /(\*\*|__)(?=\S)(.+?)(?<=\S)(\1)/y, styles: [MARK, { fontWeight: 700 }, MARK] },
  { pattern: /(~~)(?=\S)(.+?)(?<=\S)(~~)/y, styles: [MARK, { textDecoration: 'line-through' }, MARK] },
  { pattern: /(\*|_)(?=\S)(.+?)(?<=\S)(\1)/y, styles: [MARK, { fontStyle: 'italic' }, MARK] },
  { pattern: /(\[)([^\]]+)(\]\()([^)\s]+)(\))/y, styles: [MARK, { color: 'primary', textDecoration: 'underline' }, MARK, MARK, MARK] },
  { pattern: /(@)([a-z][a-z0-9_-]*)/y, styles: [{ color: 'primary' }, { color: 'primary', fontWeight: 600 }] },
  { pattern: /()([A-Z]{2,5}-\d+)\b/y, styles: [{}, { color: 'primary', fontWeight: 600 }] }
];

/** Characters that can open a token; everything else is skipped in one go. */
const OPENERS = /[`*_~[@A-Z]/;

export function inlineRuns(source: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let plain = '';
  let at = 0;

  const flush = (): void => {
    if (plain !== '') {
      runs.push({ text: plain });
      plain = '';
    }
  };

  outer: while (at < source.length) {
    const char = source[at]!;
    // A token only starts at a word boundary, so `snake_case` stays plain.
    const boundary = at === 0 || !/[A-Za-z0-9]/.test(source[at - 1]!);
    if (OPENERS.test(char) && boundary) {
      for (const token of TOKENS) {
        token.pattern.lastIndex = at;
        const match = token.pattern.exec(source);
        if (match !== null && match[0].length > 0) {
          flush();
          match.slice(1).forEach((group, index) => {
            if (group !== undefined && group !== '') {
              runs.push({ text: group, ...token.styles[index] });
            }
          });
          at += match[0].length;
          continue outer;
        }
      }
    }
    plain += char;
    at += 1;
  }
  flush();
  return runs;
}

/** Whether a set of runs still spells the source, which is the invariant Gesso checks. */
export function covers(runs: readonly InlineRun[], source: string): boolean {
  return runs.map(run => run.text).join('') === source;
}
