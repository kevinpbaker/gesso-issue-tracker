import type { ChannelSource } from 'gesso-framework';

import type { BoardCommands, BoardView } from './BoardContract';
import type { BoardStore } from './BoardStore';

/** One observable per view key, one handler per command: the whole seam. */
export function boardSource(store: BoardStore): ChannelSource<BoardView, BoardCommands> {
  return {
    view: { columns: store.columns, lanes: store.lanes, laneField: store.laneField, slots: store.slots, revisions: store.revisions },
    commands: {
      setTeam: teamId => store.setTeam(teamId),
      setLanes: field => store.setLanes(field),
      setWindow: request => store.setWindow(request),
      move: request => store.move(request),
      undo: () => store.undo()
    }
  };
}
