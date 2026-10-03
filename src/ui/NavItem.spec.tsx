import { expect, it } from 'vitest';

import { createComponent } from 'gesso-framework';
import { renderTest } from 'gesso-testing';

import { NavItem } from './NavItem';

function Sidebar() {
  return (
    <column width={220}>
      <NavItem label="Web" href="/team/web/list" detail="WEB" />
    </column>
  );
}

// The item's background is its whole box, shown on hover and when it is
// the current page, so its text has to sit in the middle of it rather
// than at its top.
it('centres its label in the item and puts the detail at the far end', () => {
  const ui = renderTest(createComponent(Sidebar, {}), { width: 300, height: 200 });
  const item = ui.getLayout(ui.getByRole('link', { name: 'Web' }));
  const label = ui.getLayout(ui.getByText('Web'));
  const detail = ui.getLayout(ui.getByText('WEB'));

  expect(label.y + label.height / 2).toBeCloseTo(item.y + item.height / 2, 0);
  expect(detail.x + detail.width).toBeCloseTo(item.x + item.width - 8, 0);
});
