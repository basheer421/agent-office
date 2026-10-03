// A worker's chat as a list of items (see protocol/agentchat.ts), the same on both sides: the
// server keeps one per chat-mode worker and the browser one per open chat, and both apply the same
// ops to it, so they agree on what's trimmed.
import type { ChatItem, ChatOp } from './protocol/agentchat.js';

/** The most items a chat keeps: older ones fall off the top. */
export const CHAT_KEEP = 300;
/** The most of a message's text kept. */
export const CHAT_TEXT_MAX = 40_000;
/** The most of a tool's output kept: its tail, which is where the result usually is. */
export const CHAT_OUTPUT_MAX = 6_000;

const head = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const tail = (s: string, max: number) => (s.length > max ? `…${s.slice(s.length - max + 1)}` : s);

/** An item cut down to what a chat keeps of it. */
export function trimItem(item: ChatItem): ChatItem {
  if (item.k === 'tool') return { ...item, args: head(item.args, 2000), output: tail(item.output, CHAT_OUTPUT_MAX) };
  if (item.k === 'user' || item.k === 'text' || item.k === 'thinking' || item.k === 'note') return { ...item, text: head(item.text, CHAT_TEXT_MAX) };
  return item;
}

export class ChatLog {
  readonly items: ChatItem[] = [];
  private byId = new Map<string, ChatItem>();

  constructor(private keep = CHAT_KEEP) {}

  get(id: string): ChatItem | undefined {
    return this.byId.get(id);
  }

  /** Applies an op; says which item it changed, if any. */
  apply(op: ChatOp): ChatItem | undefined {
    if (op.op === 'put') return this.put(op.item);
    const item = this.byId.get(op.id);
    if (!item) return undefined;
    if (op.op === 'done') {
      if (item.k === 'note' || item.k === 'user') return undefined;
      item.done = true;
      if (item.k === 'tool' && op.error) item.error = true;
    } else if (op.field === 'output' && item.k === 'tool') item.output = tail((op.replace ? '' : item.output) + op.text, CHAT_OUTPUT_MAX);
    else if (op.field === 'text' && (item.k === 'text' || item.k === 'thinking')) item.text = head((op.replace ? '' : item.text) + op.text, CHAT_TEXT_MAX);
    else return undefined;
    return item;
  }

  put(next: ChatItem): ChatItem {
    const item = trimItem(next);
    const was = this.byId.get(item.id);
    if (was) this.items[this.items.indexOf(was)] = item;
    else {
      this.items.push(item);
      while (this.items.length > this.keep) this.byId.delete(this.items.shift()!.id);
    }
    this.byId.set(item.id, item);
    return item;
  }

  reset(items: ChatItem[]) {
    this.items.length = 0;
    this.byId.clear();
    for (const item of items) this.put(item);
  }
}
