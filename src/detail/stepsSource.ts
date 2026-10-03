import type { ChannelSource } from 'gesso-framework';

import type { StepService } from './StepService';
import type { StepsCommands, StepsView } from './StepsContract';

/** One observable per view key, one handler per command: the whole seam. */
export function stepsSource(service: StepService): ChannelSource<StepsView, StepsCommands> {
  return {
    view: { at: service.at },
    commands: {
      follow: ({ key, lists }) => service.follow(key, lists),
      stop: () => service.stop()
    }
  };
}
