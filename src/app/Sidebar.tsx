import { map } from 'rxjs/operators';

import { percent } from 'gesso-core';
import type { ComponentContext, Inputs } from 'gesso-framework';

import { NavItem } from '../ui/NavItem';
import { ThemeSwitch } from './AppShell';
import { WorkspaceMeta } from './WorkspaceContract';

/** Saved views that ship with the workspace. Phase 8 lets people make their own. */
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

export function Sidebar(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const meta = ctx.channel(WorkspaceMeta);

  return (
    <column height={percent(100)} backgroundColor="surface" role="navigation" label="Sidebar">
      <row height={48} paddingLeft={16} paddingRight={12} y="center">
        <text text="Gesso Issues" fontSize={14} fontWeight={700} color="text" />
      </row>
      <scrollview flexGrow={1} paddingLeft={8} paddingRight={8} paddingBottom={12}>
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
          <Section title="Projects" />
          {meta.view.projects.pipe(
            map(projects =>
              projects.map(project => (
                <NavItem
                  key={project.id}
                  label={project.name}
                  href={`/project/${project.id}`}
                  detail={meta.view.teams.value.find(team => team.id === project.teamId)?.key ?? ''}
                />
              ))
            )
          )}
          <Section title="Phase 0 spikes" />
          <NavItem label="Markdown editor" href="/spike/editor" />
          <NavItem label="Editor, 5,000 lines" href="/spike/editor-5000" />
        </column>
      </scrollview>
      <box padding={12}>
        <ThemeSwitch />
      </box>
    </column>
  );
}
