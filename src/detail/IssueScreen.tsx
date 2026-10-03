import { combineLatest, type Observable } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';

import { autoFocus, breakpoint, percent, shortcut, type UiChild, type UiNode } from 'gesso-core';
import { Button, Combobox, DatePicker, Link, Select, type ComboboxOption, type SelectOption } from 'gesso-components';
import { FocusService, internalState, RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import { NARROW } from '../app/AppShell';
import { useCopyIssue, type CopyWhat } from '../app/copyIssue';
import { routeParam } from '../app/params';
import { ShortcutsService } from '../app/ShortcutsService';
import { WorkspaceMeta } from '../app/WorkspaceContract';
import { CommandsService } from '../palette/CommandsService';
import { COPY_LINK, copyCommands, propertyCommands } from '../palette/propertyCommands';
import { MarkdownEditor } from '../editor/MarkdownEditor';
import { MarkdownView } from '../editor/MarkdownView';
import { PRIORITY_NAMES, type Issue, type Priority } from '../model/types';
import { IssueDetailChannel, type IssueDetail, type IssueRef, type LinkKind } from './IssueDetailContract';

/**
 * `/issue/:key`: one issue, every part of it editable in place.
 *
 * The title is a field that saves on Enter or when focus leaves it, and
 * Escape puts it back. The description is the Phase 5 editor, saving a
 * moment after typing stops and again when focus leaves it. The sidebar
 * holds the properties, each a control that saves as it's changed.
 * Below the description: sub-issues, links to other issues, the
 * activity feed with its comments, and a comment box that is the same
 * editor again. The sidebar's first row copies the issue's link or its
 * key, and Mod+Shift+C copies the link from anywhere on the page.
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

/** How long typing has to stop before the description saves. */
const SAVE_AFTER_MS = 800;

function IssueBody(inputs: Inputs<{ detail: IssueDetail }>, ctx: ComponentContext) {
  const channel = ctx.channel(IssueDetailChannel);
  const router = ctx.inject(RouterService);
  const detail = inputs.detail;
  const issue = detail.pipe(map(d => d.issue!));
  const update = (patch: Partial<Issue>, label: string): void => channel.send.update({ patch, label });
  const open = (key: string): void => router.navigate(`/issue/${key}`);
  const meta = ctx.channel(WorkspaceMeta);
  const commands = ctx.inject(CommandsService);
  const { registry } = ctx.inject(ShortcutsService);
  const copyIssue = useCopyIssue(ctx);
  /** Copies this issue's link or key, as it's called now. */
  const copy = (what: CopyWhat): void => {
    const current = inputs.detail.value.issue;
    if (current !== null) copyIssue(current.key, what);
  };
  // On an issue's page, the palette changes that issue.
  ctx.onUnmount(
    commands.register(() => {
      const current = inputs.detail.value.issue;
      if (current === null) return [];
      return [
        ...copyCommands(current.key, copy),
        ...propertyCommands({ states: meta.view.states.value, users: meta.view.users.value, labels: meta.view.labels.value }, current.key, {
          update,
          addLabel: (labelId, label) => {
            const now = inputs.detail.value.issue;
            if (now !== null && !now.labelIds.includes(labelId)) update({ labelIds: [...now.labelIds, labelId] }, label);
          }
        })
      ];
    })
  );
  /** The issue as the page opened it: the body is made again for each one. */
  const opened = inputs.detail.value.issue;

  // The description saves a moment after typing stops, and when focus
  // leaves the editor; whatever is pending goes then, once.
  let pending: string | null = null;
  /** The description as this page last had it: what it mounted with, or what was typed since. */
  let mine: string | null = null;
  // The editor reads its value once, so a description that changes from
  // somewhere else (the saved copy arriving after a reload, an undo,
  // another tab) mounts a new one. Its own saves coming back don't.
  const outside = issue.pipe(
    map(i => i.description),
    distinctUntilChanged(),
    filter(text => text !== mine),
    map(text => {
      flush();
      mine = text;
      return text;
    })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    clearTimeout(timer);
    if (pending !== null) {
      update({ description: pending }, 'Edited the description');
      pending = null;
    }
  };
  ctx.onUnmount(flush);

  return (
    // Wraps rather than squeezes: below about 670 px the properties go
    // under the issue, which is what a phone, or a window zoomed past
    // 200%, needs. The narrow band's spacing is the declared one.
    <row
      gap={16}
      padding={16}
      y="start"
      flexWrap="wrap"
      width={percent(100)}
      modifiers={[
        breakpoint({ at: [NARROW], props: { 0: { gap: 16, padding: 16 }, [NARROW]: { gap: 32, padding: 32 } } }),
        shortcut({ registry, keys: 'Mod+Shift+C', label: COPY_LINK, scoped: false, group: opened?.key, run: () => copy('link') })
      ]}>
      {/* Focus starts here when the issue opens: a screen reader reads the
          issue, single-letter shortcuts still work (it isn't a field), and
          Tab goes on to the title. Not a stop of its own. */}
      <column
        flexGrow={1}
        flexShrink={1}
        flexBasis={360}
        minWidth={0}
        gap={20}
        maxWidth={780}
        role="region"
        label={issue.pipe(map(i => `${i.key} ${i.title}`))}
        focusable={true}
        tabStop={false}
        modifiers={[autoFocus()]}>
        <Breadcrumbs detail={detail} open={open} />
        <TitleField issue={issue} onSave={title => update({ title }, 'Renamed')} />
        {outside.pipe(
          map((text, round) => (
            <MarkdownEditor
              key={String(round)}
              value={text}
              fit
              label="Description"
              placeholder="Add a description…"
              onChange={markdown => {
                if (markdown === mine) return;
                mine = markdown;
                pending = markdown;
                clearTimeout(timer);
                timer = setTimeout(flush, SAVE_AFTER_MS);
              }}
              onBlur={flush}
            />
          ))
        )}
        <SubIssues detail={detail} open={open} />
        <Links detail={detail} open={open} />
        <box height={1} backgroundColor="border" />
        <Activity detail={detail} />
        <CommentBox />
      </column>
      <Properties detail={detail} update={update} copy={copy} />
    </row>
  );
}

function Breadcrumbs(inputs: Inputs<{ detail: IssueDetail; open: (key: string) => void }>, _ctx: ComponentContext) {
  const detail = inputs.detail;
  return (
    <row gap={6} y="center">
      <text text={detail.pipe(map(d => d.teamName))} fontSize={12} color="textMuted" />
      <text text="›" fontSize={12} color="textMuted" />
      {detail.pipe(
        map(d => d.parent),
        distinctUntilChanged((a, b) => a?.key === b?.key),
        map(parent =>
          parent === null
            ? []
            : [
                <Link key={parent.key} label={`${parent.key} ${parent.title}`} onPress={() => inputs.open.value(parent.key)}>
                  <text text={parent.key} fontSize={12} color="primary" />
                </Link>,
                <text key="sep" text="›" fontSize={12} color="textMuted" />
              ]
        )
      )}
      <text text={detail.pipe(map(d => d.issue!.key))} fontSize={12} color="textMuted" />
    </row>
  );
}

/**
 * The title, edited where it's read. Enter saves (it's one line, even
 * when it wraps), Escape puts it back, and leaving the field saves.
 */
function TitleField(inputs: Inputs<{ issue: Issue; onSave: (title: string) => void }>, ctx: ComponentContext) {
  const focus = ctx.inject(FocusService);
  const draft = internalState(inputs.issue.value.title);
  let editing = false;
  // The saved title shows whenever nobody is typing in it.
  ctx.effect(inputs.issue.pipe(map(i => i.title), distinctUntilChanged()), title => {
    if (!editing) draft.value = title;
  });
  const save = (): void => {
    const title = draft.value.replace(/\s+/g, ' ').trim();
    if (title === '') {
      draft.value = inputs.issue.value.title;
    } else if (title !== inputs.issue.value.title) {
      inputs.onSave.value(title);
    }
  };
  return (
    <editabletext
      value={draft}
      multiline={true}
      textWrap="word"
      fontSize={24}
      fontWeight={700}
      color="text"
      label="Title"
      padding={4}
      borderRadius={6}
      onFocus={() => (editing = true)}
      onBlur={() => {
        editing = false;
        save();
      }}
      onInput={event => (draft.value = event.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
          focus.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          draft.value = inputs.issue.value.title;
          focus.blur();
        }
      }}
    />
  );
}

/** A row that opens another issue: its state, its key and its title. */
function IssueRow(inputs: Inputs<{ issue: IssueRef; prefix?: string; open: (key: string) => void; onRemove: () => void; removeLabel: string }>, _ctx: ComponentContext) {
  const ref = inputs.issue.value;
  return (
    <row gap={10} y="center" paddingTop={6} paddingBottom={6} paddingLeft={8} paddingRight={4} borderRadius={6} backgroundColor="surface">
      {inputs.prefix.value === undefined ? [] : <text text={inputs.prefix.value} fontSize={12} color="textMuted" width={96} />}
      <box width={8} height={8} borderRadius={4} backgroundColor={ref.closed ? 'primary' : 'textMuted'} label={ref.stateName} />
      <Link label={`${ref.key} ${ref.title}`} onPress={() => inputs.open.value(ref.key)}>
        <text text={ref.key} fontSize={12} color="textMuted" />
      </Link>
      <text text={ref.title} fontSize={13} color={ref.closed ? 'textMuted' : 'text'} flexGrow={1} flexShrink={1} textWrap="none" />
      <Button size="small" variant="plain" label={inputs.removeLabel.value} onClick={() => inputs.onRemove.value()}>
        <text text="×" fontSize={14} color="textMuted" />
      </Button>
    </row>
  );
}

/**
 * A control to send the caret to, by the node its `ref` last gave.
 *
 * A row's remove button removes the row and itself with it, and an
 * "add" field is made again after each pick so it comes back empty:
 * either way the control holding the caret leaves, and without a place
 * to go the caret goes nowhere.
 */
function refocus(ctx: ComponentContext): { ref: (node: UiNode | null) => void; focus: () => void } {
  const service = ctx.inject(FocusService);
  let node: UiNode | null = null;
  return {
    // The old field's null can arrive after the new one's node.
    ref: next => {
      if (next !== null) node = next;
    },
    focus: () => {
      if (node !== null) service.focus(node);
    }
  };
}

/** The search for another issue, as combobox options: the key and title, both searchable. */
function useIssueSearch(ctx: ComponentContext): { options: Observable<readonly ComboboxOption[]>; find: (query: string) => void } {
  const channel = ctx.channel(IssueDetailChannel);
  return {
    options: channel.view.found.pipe(map(found => found.map(ref => ({ value: ref.key, label: `${ref.key} ${ref.title}`, detail: ref.stateName })))),
    find: query => channel.send.find(query)
  };
}

function SubIssues(inputs: Inputs<{ detail: IssueDetail; open: (key: string) => void }>, ctx: ComponentContext) {
  const channel = ctx.channel(IssueDetailChannel);
  const search = useIssueSearch(ctx);
  const add = refocus(ctx);
  // Re-made after each pick, so the field comes back empty.
  const round = internalState(0);
  const children = inputs.detail.pipe(map(d => d.children));
  // A sub-issue has no sub-issues of its own: one level, as the store keeps it.
  const canHave = inputs.detail.pipe(map(d => d.parent === null));
  return (
    <column gap={8} label="Sub-issues" role="region">
      <row gap={8} y="center">
        <text text="Sub-issues" fontSize={14} fontWeight={600} color="text" />
        <text
          text={children.pipe(map(list => (list.length === 0 ? '' : `${list.filter(c => c.closed).length} of ${list.length} done`)))}
          fontSize={12}
          color="textMuted"
        />
      </row>
      <column gap={4}>
        {children.pipe(
          map(list =>
            list.map(child => (
              <IssueRow
                key={child.key}
                issue={child}
                open={inputs.open.value}
                removeLabel={`Remove ${child.key} from sub-issues`}
                onRemove={() => {
                  add.focus();
                  channel.send.removeChild(child.key);
                }}
              />
            ))
          )
        )}
      </column>
      {combineLatest([canHave, round]).pipe(
        map(([can, n]) =>
          can
            ? [
                <Combobox
                  key={String(n)}
                  ref={add.ref}
                  rootModifiers={n > 0 ? [autoFocus()] : []}
                  label="Add a sub-issue"
                  labelHidden
                  placeholder="Add a sub-issue by key or title"
                  filter={false}
                  emptyText="Type a key or part of a title"
                  options={search.options}
                  onQueryChange={search.find}
                  value=""
                  onChange={key => {
                    channel.send.addChild(key);
                    round.value += 1;
                  }}
                />
              ]
            : [<text key="none" text="This is a sub-issue, so it can't have its own." fontSize={12} color="textMuted" />]
        )
      )}
    </column>
  );
}

const LINK_KINDS: readonly SelectOption[] = [
  { value: 'related', label: 'Related to' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'blocked-by', label: 'Blocked by' },
  { value: 'duplicates', label: 'Duplicates' },
  { value: 'duplicated-by', label: 'Duplicated by' }
];

function Links(inputs: Inputs<{ detail: IssueDetail; open: (key: string) => void }>, ctx: ComponentContext) {
  const channel = ctx.channel(IssueDetailChannel);
  const search = useIssueSearch(ctx);
  const add = refocus(ctx);
  const kind = internalState<string>('related');
  const round = internalState(0);
  const links = inputs.detail.pipe(map(d => d.links));
  return (
    <column gap={8} label="Links" role="region">
      <text text="Links" fontSize={14} fontWeight={600} color="text" />
      <column gap={4}>
        {links.pipe(
          map(list =>
            list.map(link => (
              <IssueRow
                key={link.id}
                issue={link.other}
                prefix={link.phrase}
                open={inputs.open.value}
                removeLabel={`Remove the link: ${link.phrase.toLowerCase()} ${link.other.key}`}
                onRemove={() => {
                  add.focus();
                  channel.send.unlink(link.id);
                }}
              />
            ))
          )
        )}
      </column>
      <row gap={8} y="start">
        <Select label="Link type" labelHidden options={LINK_KINDS} value={kind} onChange={next => (kind.value = next)} width={150} />
        {round.pipe(
          map(n => (
            <Combobox
              key={String(n)}
              ref={add.ref}
              rootModifiers={n > 0 ? [autoFocus()] : []}
              label="Link to an issue"
              labelHidden
              placeholder="Link to an issue by key or title"
              filter={false}
              emptyText="Type a key or part of a title"
              options={search.options}
              onQueryChange={search.find}
              value=""
              onChange={key => {
                channel.send.link({ key, kind: kind.value as LinkKind });
                round.value += 1;
              }}
              flexGrow={1}
            />
          ))
        )}
      </row>
    </column>
  );
}

function Activity(inputs: Inputs<{ detail: IssueDetail }>, _ctx: ComponentContext) {
  return (
    <column gap={10} x="stretch" role="region" label="Activity">
      <text text="Activity" fontSize={14} fontWeight={600} color="text" />
      {inputs.detail.pipe(
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
  );
}

/** A comment, written in the same editor as the description. Mod+Enter sends it. */
function CommentBox(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const channel = ctx.channel(IssueDetailChannel);
  const draft = internalState('');
  // A new editor after each comment: the editor reads its value once.
  const round = internalState(0);
  const send = (): void => {
    if (draft.value.trim() === '') return;
    channel.send.comment(draft.value);
    draft.value = '';
    round.value += 1;
  };
  return (
    <column gap={8}>
      {round.pipe(
        map(n => (
          <MarkdownEditor key={String(n)} value="" fit label="Comment" placeholder="Leave a comment…" onChange={markdown => (draft.value = markdown)} onSubmit={send} />
        ))
      )}
      <row x="end">
        <Button label="Comment" description="Mod+Enter" onClick={send} disabled={draft.pipe(map(text => text.trim() === ''))}>
          <text text="Comment" fontSize={13} color="background" />
        </Button>
      </row>
    </column>
  );
}

const PRIORITIES: readonly SelectOption[] = ([0, 1, 2, 3, 4] as Priority[]).map(p => ({ value: String(p), label: PRIORITY_NAMES[p] }));
// '' is an option, to clear the estimate, and also a Select's empty value,
// which it draws as its placeholder; so the placeholder says the same.
const ESTIMATES: readonly SelectOption[] = [
  { value: '', label: 'No estimate' },
  ...[1, 2, 3, 5, 8].map(points => ({ value: String(points), label: `${points} point${points === 1 ? '' : 's'}` }))
];

/** The sidebar: the issue's link and key to copy, then every property, each saving as it changes. */
function Properties(
  inputs: Inputs<{ detail: IssueDetail; update: (patch: Partial<Issue>, label: string) => void; copy: (what: CopyWhat) => void }>,
  ctx: ComponentContext
) {
  const meta = ctx.channel(WorkspaceMeta);
  const channel = ctx.channel(IssueDetailChannel);
  const search = useIssueSearch(ctx);
  const parentField = refocus(ctx);
  const issue = inputs.detail.pipe(map(d => d.issue!));
  const update = (patch: Partial<Issue>, label: string): void => inputs.update.value(patch, label);

  const states = meta.view.states.pipe(map(list => list.map(state => ({ value: state.id, label: state.name }))));
  const people = meta.view.users.pipe(
    map(users => [{ value: '', label: 'Unassigned' }, ...users.map(user => ({ value: user.id, label: user.name, detail: `@${user.handle}` }))])
  );
  const labels = meta.view.labels.pipe(map(list => list.map(label => ({ value: label.id, label: label.name }))));
  const projects = combineLatest([meta.view.projects, issue.pipe(map(i => i.teamId), distinctUntilChanged())]).pipe(
    map(([list, team]) => [{ value: '', label: 'No project' }, ...list.filter(p => p.teamId === team).map(p => ({ value: p.id, label: p.name }))])
  );
  // The parent field lists the parent it has, so its key stays shown while a search moves on.
  const parentOptions = combineLatest([search.options, inputs.detail.pipe(map(d => d.parent))]).pipe(
    map(([found, parent]) =>
      parent === null || found.some(option => option.value === parent.key) ? found : [{ value: parent.key, label: `${parent.key} ${parent.title}` }, ...found]
    )
  );

  const row = (name: string, control: UiChild) => (
    <column gap={4}>
      <text text={name} fontSize={11} color="textMuted" />
      {control}
    </column>
  );

  return (
    <column width={280} flexShrink={0} gap={14} padding={16} borderRadius={10} backgroundColor="surface" role="region" label="Properties">
      <row gap={4} x="end">
        <Button size="small" variant="plain" label="Copy link" description="Mod+Shift+C" onClick={() => inputs.copy.value('link')}>
          <text text="Copy link" fontSize={12} color="textMuted" />
        </Button>
        <Button size="small" variant="plain" label="Copy key" onClick={() => inputs.copy.value('key')}>
          <text text="Copy key" fontSize={12} color="textMuted" />
        </Button>
      </row>
      {row('Status', <Select label="Status" labelHidden options={states} value={issue.pipe(map(i => i.stateId))} onChange={stateId => update({ stateId }, 'Changed status')} />)}
      {row(
        'Priority',
        <Select label="Priority" labelHidden options={PRIORITIES} value={issue.pipe(map(i => String(i.priority)))} onChange={p => update({ priority: Number(p) as Priority }, 'Changed priority')} />
      )}
      {row(
        'Assignee',
        <Combobox
          label="Assignee"
          labelHidden
          placeholder="Unassigned"
          options={people}
          value={issue.pipe(map(i => i.assigneeId ?? ''))}
          onChange={id => update({ assigneeId: id === '' ? null : id }, 'Changed assignee')}
        />
      )}
      {row(
        'Labels',
        <Combobox
          label="Labels"
          labelHidden
          multiple
          placeholder="Add a label"
          options={labels}
          values={issue.pipe(map(i => i.labelIds))}
          onValuesChange={labelIds => update({ labelIds }, 'Changed labels')}
        />
      )}
      {row(
        'Project',
        <Select label="Project" labelHidden placeholder="No project" options={projects} value={issue.pipe(map(i => i.projectId ?? ''))} onChange={id => update({ projectId: id === '' ? null : id }, 'Changed project')} />
      )}
      {row(
        'Estimate',
        <Select
          label="Estimate"
          labelHidden
          placeholder="No estimate"
          options={ESTIMATES}
          value={issue.pipe(map(i => (i.estimate === null ? '' : String(i.estimate))))}
          onChange={points => update({ estimate: points === '' ? null : Number(points) }, 'Changed estimate')}
        />
      )}
      {row(
        'Due date',
        <DatePicker label="Due date" labelHidden value={issue.pipe(map(i => i.dueDate ?? ''))} onChange={day => update({ dueDate: day === '' ? null : day }, 'Changed due date')} />
      )}
      {row(
        'Parent issue',
        <Combobox
          label="Parent issue"
          ref={parentField.ref}
          labelHidden
          placeholder="No parent"
          filter={false}
          emptyText="Type a key or part of a title"
          options={parentOptions}
          onQueryChange={search.find}
          value={inputs.detail.pipe(map(d => d.parent?.key ?? ''))}
          onChange={key => channel.send.setParent(key === '' ? null : key)}
        />
      )}
      {inputs.detail.pipe(
        map(d => d.parent),
        map(parent =>
          parent === null
            ? []
            : [
                <Button key="unparent" size="small" variant="plain" label="Remove from parent"
                  onClick={() => {
                    parentField.focus();
                    channel.send.setParent(null);
                  }}>
                  <text text="Remove from parent" fontSize={12} color="textMuted" />
                </Button>
              ]
        )
      )}
    </column>
  );
}
