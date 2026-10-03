import { filter, map, skip } from 'rxjs/operators';

import { autoFocus, percent } from 'gesso-core';
import { Button, Dialog, form, field, maxLength, required, TextInput } from 'gesso-components';
import { RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import type { IssueQuery } from '../model/query';
import { Views } from './ViewsContract';

/**
 * Names a list as a view: a dialog with one field. Saved, the view is in
 * the sidebar and the page opens it. With `rename`, it renames the view
 * that id names instead.
 */
export function SaveViewDialog(
  inputs: Inputs<{ open: boolean; onClose: () => void; query: IssueQuery | null; rename?: { readonly id: string; readonly name: string } | null }>,
  ctx: ComponentContext
) {
  const views = ctx.channel(Views);
  const router = ctx.inject(RouterService);
  // The view just saved opens.
  ctx.effect(
    views.view.saved.pipe(
      skip(1),
      filter(saved => saved !== null)
    ),
    saved => router.navigate(`/view/${saved!.id}`)
  );
  return (
    <Dialog
      open={inputs.open}
      onClose={() => inputs.onClose.value()}
      title={inputs.rename.pipe(map(r => (r === null || r === undefined ? 'Save as a view' : 'Rename the view')))}
      width={400}
      content={<NameForm initial={inputs.rename.value?.name ?? ''} done={name => {
        const rename = inputs.rename.value;
        if (rename !== null && rename !== undefined) {
          views.send.rename({ id: rename.id, name });
        } else if (inputs.query.value !== null) {
          views.send.save({ name, query: inputs.query.value });
        }
        inputs.onClose.value();
      }} cancel={() => inputs.onClose.value()} />}
    />
  );
}

function NameForm(inputs: Inputs<{ initial: string; done: (name: string) => void; cancel: () => void }>, ctx: ComponentContext) {
  const named = form(
    ctx,
    { name: field({ initial: inputs.initial.value, label: 'Name', validate: [required('Give the view a name'), maxLength(60, 'Keep it under 60 characters')] }) },
    { onSubmit: values => inputs.done.value(values.name.trim()) }
  );
  return (
    <column gap={12} width={percent(100)}>
      <TextInput label="Name" placeholder="Urgent bugs" {...named.fields.name.bind()} onSubmit={() => void named.submit()} rootModifiers={[autoFocus()]} />
      <row gap={8} x="end">
        <Button variant="plain" label="Cancel" onClick={() => inputs.cancel.value()}>
          <text text="Cancel" fontSize={13} color="textMuted" />
        </Button>
        <Button label="Save" onClick={() => void named.submit()}>
          <text text="Save" fontSize={13} color="background" />
        </Button>
      </row>
    </column>
  );
}
