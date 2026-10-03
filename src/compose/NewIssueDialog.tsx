import { combineLatest } from 'rxjs';
import { filter, map, skip } from 'rxjs/operators';

import { autoFocus, percent } from 'gesso-core';
import {
  Button,
  Combobox,
  Dialog,
  form,
  field,
  maxLength,
  required,
  Select,
  Switch,
  TextInput,
  type SelectOption
} from 'gesso-components';
import { internalState, type ComponentContext, type Inputs } from 'gesso-framework';

import { WorkspaceMeta } from '../app/WorkspaceContract';
import { MarkdownEditor } from '../editor/MarkdownEditor';
import { PRIORITY_NAMES, type Priority } from '../model/types';
import { Compose, type Draft } from './ComposeContract';

/**
 * "New issue": a dialog over whatever screen is open. Filing one is a
 * change like any other, so the shell's undo toast says so ("Filed
 * WEB-12: …", with Undo); the dialog says it too, for "Create more",
 * where it stays open over the page.
 *
 * `c` opens it from anywhere (the shell registers the shortcut). The
 * fields are a Gesso `form()`: the title and the team are required,
 * and a submit that fails puts the caret in the first field that's
 * wrong, shows each field's message under it, and says what's wrong
 * in a live region, so a screen reader hears it. Mod+Enter files from
 * any field, Enter from the title.
 *
 * Every change is saved as the draft in the app worker, so closing the
 * dialog or reloading the page loses nothing. "Create more" keeps the
 * dialog open after filing, with the team, status, priority, assignee
 * and labels kept for the next issue and only the words cleared.
 */
export function NewIssueDialog(inputs: Inputs<{ open: boolean; onClose: () => void }>, _ctx: ComponentContext) {
  return (
    <column width={0} height={0}>
      <Dialog
        open={inputs.open}
        onClose={() => inputs.onClose.value()}
        title="New issue"
        width={600}
        content={<ComposeForm close={() => inputs.onClose.value()} />}
      />
    </column>
  );
}

const PRIORITIES: readonly SelectOption[] = ([0, 1, 2, 3, 4] as Priority[]).map(p => ({ value: String(p), label: PRIORITY_NAMES[p] }));

/** A draft as one string, its keys in a fixed order, to tell one draft from another. */
function draftKey(draft: Draft): string {
  return JSON.stringify(Object.fromEntries(Object.entries(draft).sort(([a], [b]) => a.localeCompare(b))));
}

/**
 * Waits for the saved draft, then mounts the form on it.
 *
 * A form reads its draft once. A draft that changes because this form
 * wrote it is already on screen; one that changes from anywhere else
 * (filing it, which keeps the choices for the next one in "Create
 * more", or discarding it) mounts a fresh form, which starts untouched
 * with the caret in the title.
 */
function ComposeForm(inputs: Inputs<{ close: () => void }>, ctx: ComponentContext) {
  const compose = ctx.channel(Compose);
  // Every draft this form has sent lately, not only the last: the
  // worker's echo of one can arrive after the next has been sent.
  const mine = new Set<string>();
  let mounted = -1;
  const remember = (key: string): void => {
    mine.add(key);
    if (mine.size > 100) {
      mine.delete(mine.values().next().value!);
    }
  };
  const filed = compose.view.filed.pipe(
    skip(1),
    map(f => (f === null ? '' : `Filed ${f.key}: ${f.title}`))
  );
  return (
    <column width={percent(100)} gap={8}>
      <text text={filed} live="polite" fontSize={12} color="textMuted" />
      {combineLatest([
        compose.view.draft.pipe(filter((draft): draft is Draft => draft !== null)),
        compose.view.filed.pipe(map(f => f?.serial ?? 0))
      ]).pipe(
        // A filing always starts a fresh form: the draft it keeps can be
        // the very one the last form started from.
        filter(([draft, serial]) => serial !== mounted || !mine.has(draftKey(draft))),
        map(([draft, serial], round) => {
          mounted = serial;
          mine.clear();
          remember(draftKey(draft));
          return <DraftForm key={String(round)} draft={draft} wrote={written => remember(draftKey(written))} close={inputs.close.value} />;
        })
      )}
    </column>
  );
}

function DraftForm(inputs: Inputs<{ draft: Draft; wrote: (draft: Draft) => void; close: () => void }>, ctx: ComponentContext) {
  const compose = ctx.channel(Compose);
  const meta = ctx.channel(WorkspaceMeta);
  const start = inputs.draft.value;
  const createMore = internalState(start.createMore);
  /** Bumped by every failed submit, so the same message is announced again. */
  const attempts = internalState(0);

  const issue = form(
    ctx,
    {
      title: field({ initial: start.title, label: 'Title', validate: [required('Give the issue a title'), maxLength(200, 'Keep the title under 200 characters')] }),
      description: field({ initial: start.description }),
      teamId: field({ initial: start.teamId, label: 'Team', validate: required('Choose a team') }),
      stateId: field({ initial: start.stateId }),
      priority: field({ initial: String(start.priority) }),
      assigneeId: field({ initial: start.assigneeId }),
      labelIds: field<readonly string[]>({ initial: start.labelIds })
    },
    {
      onSubmit: values => compose.send.file(draftOf(values, createMore.value))
    }
  );

  // Every change is the draft.
  ctx.effect(
    combineLatest([issue.values, createMore]).pipe(skip(1)),
    ([values, more]) => {
      const draft = draftOf(values, more);
      inputs.wrote.value(draft);
      compose.send.save(draft);
    }
  );

  const submit = async (): Promise<void> => {
    const filed = await issue.submit();
    if (!filed) {
      attempts.value += 1;
      return;
    }
    if (!createMore.value) {
      inputs.close.value();
    }
  };

  // What's wrong, said aloud: the fields that failed, in order, with why.
  const problems = combineLatest([issue.fields.title.message, issue.fields.teamId.message, issue.submitted, attempts]).pipe(
    map(([title, team, submitted, n]) => {
      if (!submitted || n === 0) return '';
      const wrong = [title === '' ? '' : `Title: ${title}`, team === '' ? '' : `Team: ${team}`].filter(Boolean);
      return wrong.length === 0 ? '' : `Can't file yet. ${wrong.join('. ')}.`;
    })
  );

  const teams = meta.view.teams.pipe(map(list => list.map(team => ({ value: team.id, label: team.name }))));
  const states = meta.view.states.pipe(map(list => list.map(state => ({ value: state.id, label: state.name }))));
  const people = meta.view.users.pipe(
    map(users => [{ value: '', label: 'Unassigned' }, ...users.map(user => ({ value: user.id, label: user.name, detail: `@${user.handle}` }))])
  );
  const labels = meta.view.labels.pipe(map(list => list.map(label => ({ value: label.id, label: label.name }))));

  return (
    <column
      gap={12}
      width={percent(100)}
      onKeyDown={event => {
        if ((event.modifiers.meta || event.modifiers.ctrl) && event.key === 'Enter') {
          event.preventDefault();
          void submit();
        }
      }}>
      <TextInput label="Title" placeholder="Issue title" {...issue.fields.title.bind()} onSubmit={() => void submit()} rootModifiers={[autoFocus()]} />
      <column gap={4}>
        <text text="Description" fontSize={12} color="controlForeground" />
        <MarkdownEditor
          value={start.description}
          fit
          label="Description"
          placeholder="Add a description…"
          onChange={markdown => issue.fields.description.change(markdown)}
          onSubmit={() => void submit()}
        />
      </column>
      <row gap={10} width={percent(100)}>
        <Select label="Team" options={teams} {...issue.fields.teamId.bind()} flexGrow={1} flexBasis={0} />
        <Select label="Status" options={states} {...issue.fields.stateId.bind()} flexGrow={1} flexBasis={0} />
        <Select label="Priority" options={PRIORITIES} {...issue.fields.priority.bind()} flexGrow={1} flexBasis={0} />
      </row>
      <row gap={10} width={percent(100)}>
        <Combobox label="Assignee" placeholder="Unassigned" options={people} {...issue.fields.assigneeId.bind()} flexGrow={1} flexBasis={0} />
        <Combobox
          label="Labels"
          placeholder="Add a label"
          multiple
          options={labels}
          values={issue.fields.labelIds.value}
          onValuesChange={next => issue.fields.labelIds.change(next)}
          flexGrow={1}
          flexBasis={0}
        />
      </row>
      <text text={problems} live="assertive" fontSize={12} color="danger" />
      <row gap={10} y="center" width={percent(100)}>
        <Switch label="Create more" checked={createMore} onChange={on => (createMore.value = on)} />
        <box flexGrow={1} />
        <Button
          variant="plain"
          label="Discard draft"
          onClick={() => {
            compose.send.discard();
            inputs.close.value();
          }}>
          <text text="Discard" fontSize={13} color="textMuted" />
        </Button>
        <Button label="Create issue" description="Mod+Enter" onClick={() => void submit()}>
          <text text="Create issue" fontSize={13} color="background" />
        </Button>
      </row>
    </column>
  );
}

function draftOf(
  values: { title: string; description: string; teamId: string; stateId: string; priority: string; assigneeId: string; labelIds: readonly string[] },
  createMore: boolean
): Draft {
  return { ...values, priority: Number(values.priority) as Priority, createMore };
}
