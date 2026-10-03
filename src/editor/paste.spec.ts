import { describe, expect, it } from 'vitest';

import { htmlToMarkdown } from './htmlMarkdown';
import { pastedBlocks, pastedMarkdown } from './paste';

describe('pasting', () => {
  it('turns HTML into markdown in the house style', () => {
    const html =
      '<h2>Steps</h2><p>Some <b>bold</b>, <i>italic</i> and <a href="https://x.dev">a link</a></p>' +
      '<ul><li>one</li><li><input type="checkbox" checked> two</li></ul><pre><code class="language-ts">const a = 1;</code></pre>';
    expect(htmlToMarkdown(html)).toBe(
      ['## Steps', '', 'Some **bold**, _italic_ and [a link](https://x.dev)', '', '- one', '- [x] two', '', '```ts', 'const a = 1;', '```'].join('\n')
    );
  });

  it('prefers the HTML, and falls back to the text', async () => {
    expect(await pastedMarkdown('plain', '<p><b>rich</b></p>')).toBe('**rich**');
    expect(await pastedMarkdown('plain', null)).toBe('plain');
    expect(await pastedMarkdown('plain', '   ')).toBe('plain');
  });

  it('makes blocks of anything but one line of text', () => {
    expect(pastedBlocks('just words')).toBeNull();
    expect(pastedBlocks('# Title\n\nbody')?.map(b => b.type)).toEqual(['heading', 'paragraph']);
    expect(pastedBlocks('- a\n- b')?.map(b => b.type)).toEqual(['bullet', 'bullet']);
  });
});
