import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

import { serialize, type Block } from './markdown';

/**
 * What a copy puts on the clipboard as HTML, beside the markdown it
 * puts there as text, so pasting into a document or an email keeps the
 * headings, lists and bold rather than showing asterisks.
 *
 * The HTML is micromark's rendering of the same markdown the text is,
 * so the two can't disagree. Raw HTML in the markdown is escaped, as
 * micromark does by default: a copy never carries markup someone typed.
 */
export function copiedHtml(blocks: readonly Block[]): string {
  return micromark(serialize(blocks), { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}
