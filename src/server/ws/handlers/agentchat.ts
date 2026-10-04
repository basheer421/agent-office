// A chat-mode worker's chat (see workers/rpc.ts): only someone who has the worker open (worker.attach)
// can read it, write to it or answer it, as with its terminal.
import type { ChatClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { workerOf } from './common.js';
import type { HandlerMap } from './types.js';

const MODES = new Set(['prompt', 'steer', 'follow_up']);

export const chatHandlers = {
  'chat.open'(ctx, c, msg) {
    const w = workerOf(ctx, msg.workerId);
    if (!w || !c.attached.has(w.wid)) return;
    const chat = w.floor.workers.chats.open(w.wid);
    if (chat) ctx.sendTo(c, { t: 'chat.snapshot', workerId: w.wid, ...chat });
  },
  'chat.send'(ctx, c, msg) {
    const w = workerOf(ctx, msg.workerId);
    if (!w || !c.attached.has(w.wid)) return;
    const mode = MODES.has(msg.mode as string) ? msg.mode : undefined;
    ctx.warn(c, w.floor.workers.chats.send(w.wid, str(msg.text, 20000), mode, c.peer.name));
  },
  'chat.abort'(ctx, c, msg) {
    const w = workerOf(ctx, msg.workerId);
    if (w && c.attached.has(w.wid)) w.floor.workers.chats.abort(w.wid);
  },
  'chat.answer'(ctx, c, msg) {
    const w = workerOf(ctx, msg.workerId);
    if (!w || !c.attached.has(w.wid)) return;
    const reply = msg.cancelled === true ? { cancelled: true } : typeof msg.confirmed === 'boolean' ? { confirmed: msg.confirmed } : { value: str(msg.value, 20000) };
    ctx.warn(c, w.floor.workers.chats.answer(w.wid, str(msg.askId, 200), reply));
  },
  'chat.mode'(ctx, c, msg) {
    const w = workerOf(ctx, msg.workerId);
    if (!w) return;
    const err = w.floor.workers.chats.setMode(w.wid, msg.chat === true);
    if (err) ctx.warn(c, err);
    else ctx.toastFloor(w.floor, `${c.peer.name} switched ${w.info.name} to ${msg.chat === true ? 'chat mode' : 'its terminal'}`);
  },
} satisfies HandlerMap<ChatClientMsg>;
