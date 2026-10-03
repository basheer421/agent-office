import { WebSocket } from 'ws';
import type { ServerMsg } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import type { Client } from './client.js';
import type { Ctx } from './context.js';

type ScreenMsg = Extract<ServerMsg, { t: 'screen' }>;

/** Above this waiting to go out, a page skips screen frames (the next keyframe catches it up). */
const SLOW_BYTES = 4 * 1024 * 1024;

/** A laptop screen's frame, to everyone on its floor who wants that worker's screen (see 'screens.watch'). */
export function sendScreen(ctx: Ctx, floor: Floor, msg: ScreenMsg) {
  let json: string | undefined;
  for (const c of ctx.clients.values()) {
    if (c.peer.floor !== floor.id || c.ws.readyState !== WebSocket.OPEN) continue;
    if (c.screens && !c.screens.has(msg.workerId)) continue;
    if (c.ws.bufferedAmount > SLOW_BYTES) continue;
    c.ws.send((json ??= JSON.stringify(msg)));
  }
}

/** Full frames of just these workers' screens, for a page that's started watching them again. */
export function sendFullScreens(ctx: Ctx, c: Client, floor: Floor, ids: ReadonlySet<string>) {
  if (!ids.size) return;
  for (const { workerId, frame } of floor.workers.fullScreens()) if (ids.has(workerId)) ctx.sendTo(c, { t: 'screen', workerId, ...frame, full: true });
}
