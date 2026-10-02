import { combineLatest } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';

import { percent } from 'gesso-core';
import { Button, TextArea } from 'gesso-components';
import { internalState, RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import { routeParam } from '../app/params';
import { MarkdownView } from '../editor/MarkdownView';
import { PRIORITY_NAMES, type Priority } from '../model/types';
import { IssueDetailChannel, type IssueDetail } from './IssueDetailContract';

/**
 * `/issue/:key`: one issue, read-only but for comments.
 *
 * Phase 6 makes every field editable and puts the Phase 5 editor in
 * the description. Phase 2 needs the route to land on something real,
 * and the comment box proves a write round trip from this screen.
 *
 * The detail channel holds whichever issue was asked for last, so the
 * screen filters it to its own question: an answer for a different key
 * is a stale one, and a frame of the previous issue's title is a flicker.
 */
export function IssueScreen(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const router = ctx.inject(RouterService);
  const channel = ctx.channel(IssueDetailChannel);
  const key = routeParam(router, 'key').pipe(map(value => value ?? ''));
  ctx.effect(key, asked => channel.send.open(asked));

  const detail = combineLatest([key, channel.view.detail]).pipe(
    filter(([asked, answer]) => answer !== null && answer.asked === asked),
    map(([, answer]) => answer as IssueDetail)
  );

  return (
    <scrollview width={percent(100)} height={percent(100)} x="stretch">
      {detail.pipe(
        map(d => (d.issue === null ? 'missing' : d.issue.id)),
        distinctUntilChanged(),
        map(state =>
          state === 'missing' ? (
            <box key="missing" padding={40} width={percent(100)} x="center">
              <text text="No issue has that key." fontSize={14} color="textMuted" />
            </box>
          ) : (
            <IssueBody key={state} detail={detail} />
          )
        )
      )}
    </scrollview>
  );
}

function IssueBody(inputs: Inputs<{ detail: IssueDetail }>, ctx: ComponentContext) {
  const channel = ctx.channel(IssueDetailChannel);
  const detail = inputs.detail;
  const draft = internalState('');
  const issue = detail.pipe(map(d => d.issue!));

  const send = (): void => {
    if (draft.value.trim() !== '') {
      channel.send.comment(draft.value);
      draft.value = '';
    }
  };

  const property = (name: string, value: ReturnType<typeof detail.pipe<string>>) => (
    <column gap={2}>
      <text text={name} fontSize={11} color="textMuted" />
      <text text={value} fontSize={13} color="text" />
    </column>
  );

  return (
    <row gap={32} padding={32} y="start">
      <column flexGrow={1} flexShrink={1} gap={20} maxWidth={760} role="region" label={issue.pipe(map(i => `${i.key} ${i.title}`))}>
        <text text={issue.pipe(map(i => i.title))} fontSize={22} fontWeight={700} color="text" />
        <MarkdownView source={issue.pipe(map(i => i.description))} />
        <box height={1} backgroundColor="border" />
        <text text="Activity" fontSize={14} fontWeight={600} color="text" />
        <column gap={10} x="stretch">
          {detail.pipe(
            map(d =>
              [
                ...d.comments.map(c => ({ at: c.createdAt, id: c.id, kind: 'comment' as const, who: c.author, body: c.body })),
                ...d.activity.map(a => ({ at: a.at, id: a.id, kind: 'event' as const, who: '', body: a.text }))
              ]
                .sort((a, b) => a.at - b.at)
                .map(entry =>
                  entry.kind === 'event' ? (
                    <text key={entry.id} text={entry.body} fontSize={12} color="textMuted" />
                  ) : (
                    <column key={entry.id} gap={6} padding={12} borderRadius={8} borderWidth={1} borderColor="border">
                      <text text={entry.who} fontSize={12} fontWeight={600} color="text" />
                      <MarkdownView source={entry.body} />
                    </column>
                  )
                )
            )
          )}
        </column>
        <TextArea label="Leave a comment" placeholder="Markdown works here" value={draft} onChange={next => (draft.value = next)} />
        <row x="end">
          <Button label="Comment" onClick={send} disabled={draft.pipe(map(text => text.trim() === ''))}>
            <text text="Comment" fontSize={13} color="background" />
          </Button>
        </row>
      </column>
      <column width={220} flexShrink={0} gap={16} padding={16} borderRadius={10} backgroundColor="surface" label="Properties">
        {property('Status', detail.pipe(map(d => d.stateName)))}
        {property('Priority', issue.pipe(map(i => PRIORITY_NAMES[i.priority as Priority])))}
        {property('Assignee', detail.pipe(map(d => d.assigneeName || 'Unassigned')))}
        {property('Labels', detail.pipe(map(d => d.labels.join(', ') || 'None')))}
        {property('Project', detail.pipe(map(d => d.projectName || 'None')))}
        {property('Team', detail.pipe(map(d => d.teamName)))}
        {property('Key', issue.pipe(map(i => i.key)))}
      </column>
    </row>
  );
}
