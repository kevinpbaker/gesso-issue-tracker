import { defineModifier, type LayoutBox, type UiModifierHost } from 'gesso-core';

/**
 * Lets a component ask where its node is, when it needs to: a drop
 * index from the pointer, or whether a row is scrolled into view. Only
 * a modifier can read a box, so this is one, holding its host.
 */
export class Probe {
  host: UiModifierHost | null = null;
  readonly modifier = probeKind({ probe: this });

  /** `laidOut` runs after each layout of the node: for work that needs its size, such as a scroll put back. */
  constructor(readonly laidOut?: () => void) {}

  box(): LayoutBox | null {
    return this.host?.layoutBox() ?? null;
  }
}

const probeKind = defineModifier<{ probe: Probe }>({
  name: 'probe',
  attach(host, { probe }) {
    probe.host = host;
    if (probe.laidOut !== undefined) host.onLayout(() => probe.laidOut?.());
    host.own(() => {
      if (probe.host === host) probe.host = null;
    });
  }
});
