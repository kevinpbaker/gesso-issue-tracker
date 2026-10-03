import { map } from 'rxjs/operators';

import { percent } from 'gesso-core';
import type { ComponentContext, Inputs } from 'gesso-framework';

import { readingRuns } from './inline';
import { parse, type Block } from './markdown';

/**
 * Markdown, drawn read-only: the same block parser and inline styler
 * the editor uses, without the markers the editor has to keep, so a
 * comment reads as formatted text. Phase 6 swaps this for the
 * Phase 5 editor on the issue page.
 */

const HEADING_SIZES = [22, 18, 16, 15, 14, 14];
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export function MarkdownView(inputs: Inputs<{ source: string }>, _ctx: ComponentContext) {
  return (
    <column gap={8} x="stretch">
      {inputs.source.pipe(
        map(source => {
          let number = 0;
          return parse(source).map((block, index) => {
            number = block.type === 'ordered' ? number + 1 : 0;
            return <BlockLine key={String(index)} block={block} number={number} />;
          });
        })
      )}
    </column>
  );
}

function BlockLine(inputs: Inputs<{ block: Block; number: number }>, _ctx: ComponentContext) {
  const block = inputs.block.value;
  const spans = readingRuns(block.text);
  const text = (size: number, weight = 400) => (
    <text spans={spans} fontSize={size} fontWeight={weight} color="text" flexShrink={1} />
  );
  const pad = (block.indent ?? 0) * 20;
  switch (block.type) {
    case 'heading':
      return <box paddingTop={6}>{text(HEADING_SIZES[(block.level ?? 1) - 1]!, 700)}</box>;
    case 'bullet':
    case 'ordered':
    case 'task':
      return (
        <row gap={8} paddingLeft={pad}>
          <text
            text={block.type === 'bullet' ? '•' : block.type === 'ordered' ? `${inputs.number.value}.` : block.checked ? '☑' : '☐'}
            fontSize={14}
            color="textMuted"
            width={18}
          />
          {text(14)}
        </row>
      );
    case 'quote':
      return (
        <row gap={10}>
          <box width={3} backgroundColor="border" borderRadius={2} />
          {text(14)}
        </row>
      );
    case 'code':
    case 'raw':
      return (
        <box padding={10} borderRadius={6} backgroundColor="surface" width={percent(100)}>
          <text text={block.text} fontSize={12} fontFamily={MONO} color="text" />
        </box>
      );
    case 'rule':
      return <box height={1} backgroundColor="border" />;
    default:
      return text(14);
  }
}
