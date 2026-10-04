import { describe, expect, it } from 'vitest';

import { UiShortcutRegistry } from 'gesso-core';

import { EDITOR_SHORTCUTS } from '../editor/MarkdownEditor';
import { filterSections, sheetSections } from './ShortcutSheet';

/**
 * What the keyboard shortcut sheet lists, from a registry: the shell's
 * keys first and the editor's last, a row per thing with every key that
 * does it, and a key two shortcuts want listed for the one that runs.
 */
describe('sheetSections', () => {
  const run = () => {};

  it("groups by heading, the shell's first and the editor's last, and joins the keys that share a label", () => {
    const registry = new UiShortcutRegistry();
    registry.register({ keys: 'j', label: 'Next issue', group: 'List', run });
    registry.register({ keys: 'ArrowDown', label: 'Next issue', group: 'List', run });
    registry.register({ keys: 'Mod+K', label: 'Open the command palette', run });
    const sections = sheetSections(registry.active(null), true);

    expect(sections.map(section => section.group)).toEqual(['Global', 'List', 'Editor']);
    expect(sections[1]!.rows).toEqual([{ label: 'Next issue', keys: [[['J']], [['↓']]], name: 'Next issue, j or Down arrow' }]);
    expect(sections[2]!.rows.map(row => row.label)).toEqual(EDITOR_SHORTCUTS.map(entry => entry.label));
  });

  it('lists a key two live shortcuts want for the one that would run', () => {
    const registry = new UiShortcutRegistry();
    registry.register({ keys: 'Escape', label: 'Close the sidebar', run });
    registry.register({ keys: 'Escape', label: 'Clear the selection', group: 'List', priority: 1, run });
    const labels = sheetSections(registry.active(null), false).flatMap(section => section.rows.map(row => row.label));
    expect(labels).toEqual(['Clear the selection']);
  });

  it('filters on the start of every word, by what a shortcut does, its heading or its keys', () => {
    const registry = new UiShortcutRegistry();
    registry.register({ keys: 'ArrowDown', label: 'Next issue', group: 'List', run });
    registry.register({ keys: 'x', label: 'Select the issue', group: 'List', run });
    registry.register({ keys: 'Mod+Shift+M', label: 'Show the markdown source', group: 'List', run });
    const sections = sheetSections(registry.active(null), false);
    const found = (query: string) => filterSections(sections, query).flatMap(section => section.rows.map(row => row.label));
    expect(found('list sel')).toEqual(['Select the issue']);
    expect(found('X')).toEqual(['Select the issue']);
    // The words of a key's name too, and only from their start.
    expect(found('down')).toEqual(['Next issue']);
    expect(filterSections(sections, 'nothing like it')).toEqual([]);
  });
});
