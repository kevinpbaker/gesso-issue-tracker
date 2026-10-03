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

/**
 * What a paste is, as markdown: its HTML converted when it has some,
 * else its text. Async because the converter is loaded the first time
 * it's needed; see `htmlMarkdown.ts`.
 */
export async function pastedMarkdown(text: string, html: string | null): Promise<string> {
  if (html !== null && html.trim() !== '') {
    const { htmlToMarkdown } = await import('./htmlMarkdown');
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
