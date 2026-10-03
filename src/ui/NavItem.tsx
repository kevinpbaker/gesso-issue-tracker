import { map } from 'rxjs/operators';

import { interactive } from 'gesso-core';
import { RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

/** Hoisted: modifier arguments are compared by identity. */
const HOVER = interactive({ hover: true, press: false, hovered: { backgroundColor: 'controlBackgroundHovered' } });

/**
 * One link in the sidebar: a button that navigates, and that shows it
 * is current when the url is its own. Reaching it with Tab and
 * pressing Enter is the keyboard path to every route.
 */
export function NavItem(
  inputs: Inputs<{ label: string; href: string; detail?: string; indent?: number; name?: string }>,
  ctx: ComponentContext
) {
  const router = ctx.inject(RouterService);
  const href = inputs.href.value;
  const active = router.url.pipe(map(url => url === href || url.startsWith(`${href}?`)));

  return (
    <button
      label={inputs.name.pipe(map(name => name ?? inputs.label.value))}
      onClick={() => router.navigate(href)}
      // A link to a page, and the open page's is the current one: a
      // screen reader ignores `selected` on a link or a button.
      role="link"
      states={active.pipe(map(on => (on ? ['current'] : [])))}
      height={30}
      paddingLeft={8 + (inputs.indent.value ?? 0) * 14}
      paddingRight={8}
      borderRadius={6}
      cursor="pointer"
      backgroundColor={active.pipe(map(on => (on ? 'controlBackground' : 'surface')))}
      modifiers={[HOVER]}>
      <row x="space-between" y="center" gap={8}>
        <box flexShrink={1} minWidth={0}>
          <text
            text={inputs.label}
            fontSize={13}
            fontWeight={active.pipe(map(on => (on ? 600 : 400)))}
            color="text"
            maxLines={1}
            textOverflow="ellipsis"
          />
        </box>
        <text text={inputs.detail.pipe(map(detail => detail ?? ''))} fontSize={11} color="textMuted" flexShrink={0} />
      </row>
    </button>
  );
}
