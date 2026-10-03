/**
 * Inline formatting as text edits on a block's markdown source.
 *
 * A block's text is its inline markdown, so making something bold is
 * putting `**` either side of it, and making it not bold is taking them
 * away. These work on one string and a range in it, return the new
 * string and where the selection goes, and know nothing of the editor.
 */

export type Mark = 'bold' | 'italic' | 'code' | 'strike';

export const MARKERS: Readonly<Record<Mark, string>> = {
  bold: '**',
  italic: '_',
  code: '`',
  strike: '~~'
};

export interface Formatted {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Toggles a mark over `start`..`end`.
 *
 * Off when the range is already marked, whether the markers sit just
 * outside it (`**|bold|**`, what selecting a word in bold text gives) or
 * just inside it (`|**bold**|`, what selecting the whole run gives). On
 * otherwise. An empty range gets an empty pair with the caret between,
 * ready to type into.
 */
export function toggleMark(text: string, start: number, end: number, mark: Mark): Formatted {
  const marker = MARKERS[mark];
  const m = marker.length;
  const inner = text.slice(start, end);
  // Each side of the range is marked if a marker sits just outside it
  // or just inside it. Both sides marked, in any mix, is a mark to take
  // off: a selection across blocks ends a block's part at the block's
  // end, which is past its closing marker.
  const leftOutside = start >= m && text.slice(start - m, start) === marker;
  const rightOutside = text.slice(end, end + m) === marker;
  const leftInside = !leftOutside && inner.startsWith(marker);
  const rightInside = !rightOutside && inner.length >= (leftInside ? 2 * m : m) && inner.endsWith(marker);
  if ((leftOutside || leftInside) && (rightOutside || rightInside)) {
    const left = leftOutside ? start - m : start;
    const right = rightOutside ? end : end - m;
    return {
      text: text.slice(0, left) + text.slice(left + m, right) + text.slice(right + m),
      start: left,
      end: right - m
    };
  }
  // Leading and trailing spaces stay outside the markers, or
  // `** bold**` would not read as bold at all.
  const lead = /^\s*/.exec(inner)![0].length;
  const trail = inner.length === lead ? 0 : /\s*$/.exec(inner)![0].length;
  const from = start + lead;
  const to = end - trail;
  return {
    text: text.slice(0, from) + marker + text.slice(from, to) + marker + text.slice(to),
    start: from + m,
    end: to + m
  };
}

/**
 * Makes `start`..`end` a link, and selects where its address goes so
 * the next thing typed is the address. With nothing selected, the link
 * text is selected instead.
 */
export function makeLink(text: string, start: number, end: number): Formatted {
  const label = text.slice(start, end);
  if (label.length === 0) {
    const inserted = '[link](url)';
    return { text: text.slice(0, start) + inserted + text.slice(end), start: start + 1, end: start + 5 };
  }
  const head = text.slice(0, start) + '[' + label + '](';
  return { text: head + 'url)' + text.slice(end), start: head.length, end: head.length + 3 };
}
