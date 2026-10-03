// Cards dragged between the change request board's columns (see board-moves.ts), as whoever drags.
import type { BoardMovesClientMsg } from '../../../shared/protocol.js';
import { CR_MOVES } from '../../../shared/protocol.js';
import { moveCr, movedWords } from '../../board-moves.js';
import { num } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';

export const boardMovesHandlers = {
  'cr.move'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const move = CR_MOVES.find((m) => m === msg.move);
    if (!floor || !Number.isSafeInteger(n) || n <= 0 || !move) return;
    const { crShort, refPrefix } = floor.boards.host.words;
    ctx.withGitHub(
      c,
      (as) =>
        void moveCr(floor.boards, n, move, as).then((error) => {
          ctx.sendTo(c, { t: 'cr.moved', number: n, move, error });
          if (!error) ctx.toastFloor(floor, `${who} ${movedWords(move, `${crShort} ${refPrefix}${n}`)}`);
        }),
      (error) => ctx.sendTo(c, { t: 'cr.moved', number: n, move, error }),
    );
  },
} satisfies HandlerMap<BoardMovesClientMsg>;
