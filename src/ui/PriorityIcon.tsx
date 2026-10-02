import { map } from 'rxjs/operators';

import type { ComponentContext, Inputs } from 'gesso-framework';

import { PRIORITY_NAMES, type Priority } from '../model/types';

/**
 * Linear's priority mark: three bars, filled to the level, an
 * exclamation box for urgent, and a dash for none. Drawn from boxes and
 * tokens, so it follows the theme with no image.
 */
export function PriorityIcon(inputs: Inputs<{ priority: number }>, _ctx: ComponentContext) {
  const priority = inputs.priority;
  const bar = (height: number, level: number) => (
    <box
      width={3}
      height={height}
      borderRadius={1}
      backgroundColor={priority.pipe(map(p => (p !== 0 && p <= level ? 'text' : 'border')))}
    />
  );
  return (
    <box width={16} height={16} x="center" y="center" label={priority.pipe(map(p => PRIORITY_NAMES[p as Priority] ?? 'No priority'))}>
      {priority.pipe(
        map(p =>
          p === 1 ? (
            <box key="urgent" width={14} height={14} borderRadius={3} backgroundColor="danger" x="center" y="center">
              <text text="!" fontSize={10} fontWeight={700} color="background" />
            </box>
          ) : p === 0 ? (
            <text key="none" text="—" fontSize={11} color="textMuted" />
          ) : (
            <row key="bars" gap={2} y="end" height={12}>
              {bar(5, 4)}
              {bar(8, 3)}
              {bar(11, 2)}
            </row>
          )
        )
      )}
    </box>
  );
}
