// Which workers' laptop screens each page wants: only those are streamed to it (see office/screens.ts).
import type { ScreensClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { sendFullScreens } from '../../office/screens.js';
import type { FeatureHooks, HandlerMap } from './types.js';

/** More than any floor has desks. */
const MAX_WATCHED = 128;

export const screenHandlers = {
  'screens.watch'(ctx, c, msg) {
    if (!Array.isArray(msg.workerIds)) return;
    const next = new Set(msg.workerIds.slice(0, MAX_WATCHED).map((x) => str(x, 64)).filter(Boolean));
    const was = c.screens;
    c.screens = next;
    // Ones it wasn't getting have missed frames: start them over. Before this, it was getting them all.
    const floor = ctx.floorOf(c);
    if (was && floor) sendFullScreens(ctx, c, floor, new Set([...next].filter((id) => !was.has(id))));
  },
} satisfies HandlerMap<ScreensClientMsg>;

export const screenHooks: FeatureHooks = {
  // A new floor starts with every screen (its arrival sends them all) until the page says which it wants.
  leaving(_ctx, c) {
    c.screens = undefined;
  },
};
