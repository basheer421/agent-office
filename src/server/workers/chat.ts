// What browsers do with a chat-mode worker's chat (see rpc.ts): open it, write to it, stop its turn,
// answer what it asks, and move it between chat mode and its terminal.
import type { ChatFooter, ChatItem, ChatSendMode } from '../../shared/protocol.js';
import { providerAdapter } from '../providers/index.js';
import { rpcOf } from './rpc.js';
import type { WorkerContext } from './types.js';
import { truncate } from './util.js';

export class WorkerChats {
  constructor(private ctx: WorkerContext) {}

  /** Its chat so far, for a browser opening it. */
  open(id: string): { items: ChatItem[]; footer: ChatFooter } | undefined {
    const w = this.ctx.workers.get(id);
    if (!w?.info.chat) return undefined;
    rpcOf(this.ctx, id)?.flush();
    return w.chat ? { items: w.chat.log.items, footer: w.chat.footer } : { items: [], footer: { busy: false, status: [], widgets: [] } };
  }

  /** A message from `by`: to its session while it runs, else it wakes up with it. */
  send(id: string, text: string, mode: ChatSendMode | undefined, by: string): string | undefined {
    const w = this.ctx.workers.get(id);
    if (!w?.info.chat) return 'That worker is not in chat mode';
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'Empty message';
    w.info.lastInput = { by, at: Date.now() };
    const session = rpcOf(this.ctx, id);
    if (!session) return this.ctx.resume(id, clean);
    session.send(clean, mode);
    if (mode !== 'steer') w.info.activity = truncate(clean, 80);
    this.ctx.notePrompt(w, clean);
    this.ctx.emit(w);
    return undefined;
  }

  abort(id: string) {
    rpcOf(this.ctx, id)?.abort();
  }

  answer(id: string, askId: string, reply: { value?: string; confirmed?: boolean; cancelled?: boolean }): string | undefined {
    const session = rpcOf(this.ctx, id);
    return session ? session.answer(askId, reply) : 'That worker is not running';
  }

  /** Moves a worker between chat mode and its terminal: it starts again, carrying on its session. */
  setMode(id: string, chat: boolean): string | undefined {
    const w = this.ctx.workers.get(id);
    if (!w) return 'No such worker';
    if (w.info.kind !== 'agent' || !providerAdapter(w.info.provider)?.chat) return "That worker's agent has no chat mode";
    if (!!w.info.chat === chat) return undefined;
    w.info.chat = chat || undefined;
    const proc = w.pty;
    const session = w.dsh;
    // Gone before it exits, so the exit handler knows it was the office and stays quiet.
    w.pty = undefined;
    w.dsh = undefined;
    try {
      session?.close();
      proc?.kill();
    } catch {
      // already gone
    }
    if (proc || session) w.info.status = 'exited';
    this.ctx.persist();
    return this.ctx.resume(id);
  }
}
