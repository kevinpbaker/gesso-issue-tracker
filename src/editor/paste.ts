import { fromHtml } from 'hast-util-from-html';
import { toMdast } from 'hast-util-to-mdast';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';

import { detached, parse, type Block } from './markdown';

/**
 * What a paste becomes in the editor: markdown, then blocks.
 *
 * HTML from another tab or a document is converted to the closest
 * markdown (headings, lists, task lists, links, emphasis, code, tables),
 * in the house style the serializer writes. Plain text is taken as
 * markdown already, since that's what people paste into a markdown
 * editor.
 */

export function htmlToMarkdown(html: string): string {
  const tree = toMdast(fromHtml(html, { fragment: true }));
  return toMarkdown(tree, {
    bullet: '-',
    emphasis: '_',
    strong: '*',
    fence: '`',
    rule: '-',
    extensions: [gfmToMarkdown()]
  }).replace(/\n+$/, '');
}

/** What a paste is, as markdown: its HTML converted when it has some, else its text. */
export function pastedMarkdown(text: string, html: string | null): string {
  if (html !== null && html.trim() !== '') {
    const converted = htmlToMarkdown(html);
    if (converted.trim() !== '') {
      return converted;
    }
  }
  return text;
}

/**
 * The blocks pasted markdown makes, written fresh rather than as copies
 * of their source: they're new to this document. One plain paragraph is
 * not blocks at all but inline text, and comes back as null.
 */
export function pastedBlocks(markdown: string): Block[] | null {
  const blocks = parse(markdown).map(detached);
  if (blocks.length === 1 && blocks[0]!.type === 'paragraph' && !blocks[0]!.text.includes('\n')) {
    return null;
  }
  return blocks;
}
