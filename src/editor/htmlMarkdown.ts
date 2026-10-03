import { fromHtml } from 'hast-util-from-html';
import { toMdast } from 'hast-util-to-mdast';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';

/**
 * HTML to markdown, in the house style the serializer writes.
 *
 * Its own module because the HTML parser behind it is most of a
 * render worker's weight (parse5, about 270 kB). `paste.ts` imports it
 * on the first paste that carries HTML, so an editor that is never
 * pasted into from another page never loads it.
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
