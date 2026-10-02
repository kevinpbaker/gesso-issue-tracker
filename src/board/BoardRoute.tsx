import { RouterService, type ComponentContext, type Inputs } from 'gesso-framework';

import { routeParam } from '../app/params';
import { Board } from './BoardContract';
import { BoardScreen } from './BoardScreen';

/** `/team/:key/board`: tells the board which team, then draws it. */
export function BoardRoute(_inputs: Inputs<{}>, ctx: ComponentContext) {
  const router = ctx.inject(RouterService);
  const board = ctx.channel(Board);
  ctx.effect(routeParam(router, 'key'), team => board.send.setTeam(team));
  return <BoardScreen />;
}
