import { map } from 'rxjs/operators';

import { autoFocus, percent, shortcut, shortcuts } from 'gesso-core';
import { Button } from 'gesso-components';
import type { ComponentContext, Inputs } from 'gesso-framework';

import { ShortcutsService } from './ShortcutsService';

import { NavItem } from '../ui/NavItem';
import { ThemeSwitch } from './AppShell';
import { WorkspaceMeta } from './WorkspaceContract';
import { Views } from '../views/ViewsContract';

/** Views that ship with the workspace; the ones people save follow them. */
export const BUILT_IN_VIEWS = [
  { id: 'all', name: 'All issues' },
  { id: 'active', name: 'Active' },
  { id: 'backlog', name: 'Backlog' },
  { id: 'urgent', name: 'Urgent' }
] as const;

function Section(inputs: Inputs<{ title: string }>, _ctx: ComponentContext) {
  return (
    <text text={inputs.title} fontSize={11} fontWeight={600} color="textMuted" paddingLeft={8} paddingTop={14} paddingBottom={4} />
  );
}

/** `onClose` is given when the sidebar stands in for the page, and shows a Close button that brings it back. */
export function Sidebar(inputs: Inputs<{ onClose?: () => void }>, ctx: ComponentContext) {
  const meta = ctx.channel(WorkspaceMeta);
  const views = ctx.channel(Views);
  const { registry } = ctx.inject(ShortcutsService);

  return (
    <column
      height={percent(100)}
      flexGrow={1}
      backgroundColor="surface"
      role="navigation"
      label="Sidebar"
      modifiers={
        inputs.onClose.value === undefined
          ? []
          : [shortcuts({ registry }), shortcut({ registry, keys: 'Escape', label: 'Close the sidebar', run: () => inputs.onClose.value?.() })]
      }>
      <row height={48} paddingLeft={16} paddingRight={12} y="center" x="space-between">
        <text text="Gesso Issues" fontSize={14} fontWeight={700} color="text" />
        {inputs.onClose.value === undefined ? (
          []
        ) : (
          // Takes the keyboard as the panel opens, so Escape or Enter goes straight back.
          <Button label="Close the sidebar" size="small" variant="plain" onClick={() => inputs.onClose.value?.()} rootModifiers={[autoFocus()]}>
            <text text="Close" fontSize={12} color="text" />
          </Button>
        )}
      </row>
      <scrollview flexGrow={1} flexBasis={0} paddingLeft={8} paddingRight={8} paddingBottom={12}>
        <column gap={2} x="stretch">
          <NavItem label="My issues" href="/my-issues" />
          <Section title="Teams" />
          {meta.view.teams.pipe(
            map(teams =>
              teams.map(team => (
                <column key={team.id} gap={2} x="stretch">
                  <NavItem label={team.name} href={`/team/${team.id}/list`} detail={team.key} />
                  <NavItem label="Board" name={`${team.name} board`} href={`/team/${team.id}/board`} indent={1} />
                </column>
              ))
            )
          )}
          <Section title="Views" />
          {BUILT_IN_VIEWS.map(view => (
            <NavItem key={view.id} label={view.name} href={`/view/${view.id}`} />
          ))}
          {views.view.views.pipe(map(saved => saved.map(view => <NavItem key={view.id} label={view.name} href={`/view/${view.id}`} />)))}
          <Section title="Projects" />
          {meta.view.projects.pipe(
            map(projects =>
              projects.map(project => {
                const team = meta.view.teams.value.find(t => t.id === project.teamId);
                // Several teams have a "Q3 launch": the team key tells them
                // apart on screen, and the team's name does when it's heard.
                return (
                  <NavItem
                    key={project.id}
                    label={project.name}
                    name={team === undefined ? project.name : `${project.name}, ${team.name}`}
                    href={`/project/${project.id}`}
                    detail={team?.key ?? ''}
                  />
                );
              })
            )
          )}
          <Section title="Editor" />
          <NavItem label="Sample document" href="/editor" />
          <NavItem label="5,000 lines" href="/editor/long" />
        </column>
      </scrollview>
      <box padding={12}>
        <ThemeSwitch />
      </box>
    </column>
  );
}
