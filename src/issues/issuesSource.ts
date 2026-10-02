import type { ChannelSource } from 'gesso-framework';

import type { IssueStore } from '../model/IssueStore';
import type { IssueQueryService } from './IssueQueryService';
import type { IssuesCommands, IssuesView } from './IssuesContract';

/** One observable per view key, one handler per command: the whole seam. */
export function issuesSource(
  service: IssueQueryService,
  store: IssueStore,
  reset: () => void
): ChannelSource<IssuesView, IssuesCommands> {
  return {
    view: {
      query: service.query,
      summary: service.summary,
      window: service.window,
      rows: service.rows,
      selected: service.selected,
      selectedCount: service.selectedCount,
      undoLabel: service.undoLabel
    },
    commands: {
      setQuery: query => service.setQuery(query),
      setWindow: range => service.setWindow(range),
      update: ({ ids, patch, label }) => void store.update(ids, patch, label),
      select: ({ ranges, mode }) => service.select(ranges, mode),
      clearSelection: () => service.clearSelection(),
      updateSelected: ({ patch, label }) => service.updateSelected(patch, label),
      addLabelToSelected: ({ labelId, label }) => service.addLabelToSelected(labelId, label),
      undo: () => void store.undo(),
      redo: () => void store.redo(),
      reset
    }
  };
}
