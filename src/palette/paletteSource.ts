import type { ChannelSource } from 'gesso-framework';

import type { PaletteCommands, PaletteView } from './PaletteContract';
import type { PaletteService } from './PaletteService';

/** The palette channel, served from the service: what the app worker serves, and what a spec does. */
export function paletteSource(palette: PaletteService): ChannelSource<PaletteView, PaletteCommands> {
  return {
    view: { results: palette.results },
    commands: {
      setCatalog: entries => palette.setCatalog(entries),
      setOpenIssue: key => palette.setOpenIssue(key),
      search: query => palette.search(query)
    }
  };
}
