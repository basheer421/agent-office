// Pi's --mode rpc events, turned into a chat (see shared/protocol/agentchat.ts). Pure: it takes one
// parsed JSONL event at a time and says what changed. The events carry far more than a browser needs
// (message_end and agent_end hold whole conversations), so only what's drawn is kept.
import type { ChatAskMethod, ChatItem, ChatOp } from '../../shared/protocol/agentchat.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** What one event meant, besides changes to the chat. */
export interface RpcSignal {
  /** It started or settled a run. */
  busy?: boolean;
  /** It asks something and waits for an answer. */
  ask?: string;
  /** A tool it's calling, for naming its task. */
  tool?: string;
  /** A status line (setStatus) or widget (setWidget) under its chat, by key; undefined clears it. */
  status?: [string, string | undefined];
  widget?: [string, string | undefined];
  /** A tool call's command line and output, when it ran one (for the pull requests it opens). */
  ran?: { command: string; output: string };
}

/** A tool call's arguments in a line: the command, path or pattern it was for, else its JSON. */
export function argsLine(name: string, args: unknown): string {
  const a = rec(args);
  const pick = a.command ?? a.path ?? a.file_path ?? a.pattern ?? a.query ?? a.url;
  if (typeof pick === 'string') return name === 'edit' && Array.isArray(a.edits) ? `${pick} (${a.edits.length} edit${a.edits.length === 1 ? '' : 's'})` : pick;
  try {
    const json = JSON.stringify(args);
    return json && json !== '{}' ? json : '';
  } catch {
    return '';
  }
}

/** The text of a message's or a tool result's content: a string, or text blocks. */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => (rec(c).type === 'text' ? text(rec(c).text) : rec(c).type === 'image' ? '[image]' : '')).filter(Boolean).join('\n');
}

/** A conversation as Pi gives it (get_messages), as chat items: what a resumed chat starts with. */
export function itemsOfMessages(messages: unknown): ChatItem[] {
  const items: ChatItem[] = [];
  const tools = new Map<string, Extract<ChatItem, { k: 'tool' }>>();
  (Array.isArray(messages) ? messages : []).forEach((m, i) => {
    const msg = rec(m);
    if (msg.role === 'user') {
      const t = contentText(msg.content).trim();
      if (t) items.push({ id: `h${i}`, k: 'user', text: t });
    } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      msg.content.forEach((c, j) => {
        const b = rec(c);
        if (b.type === 'text' && text(b.text).trim()) items.push({ id: `h${i}-${j}`, k: 'text', text: text(b.text), done: true });
        else if (b.type === 'thinking' && text(b.thinking).trim()) items.push({ id: `h${i}-${j}`, k: 'thinking', text: text(b.thinking), done: true });
        else if (b.type === 'toolCall') {
          const item: Extract<ChatItem, { k: 'tool' }> = { id: `tool-${text(b.id) || `${i}-${j}`}`, k: 'tool', name: text(b.name), args: argsLine(text(b.name), b.arguments), output: '', done: true };
          tools.set(text(b.id), item);
          items.push(item);
        }
      });
    } else if (msg.role === 'toolResult') {
      const item = tools.get(text(msg.toolCallId));
      if (item) {
        item.output = contentText(msg.content);
        item.error = msg.isError === true || undefined;
      }
    }
  });
  return items;
}

const ASKS = new Set<ChatAskMethod>(['select', 'confirm', 'input', 'editor']);

export class RpcChat {
  /** The assistant message being streamed: its items are `a<n>-<content index>`. */
  private turn = 0;
  private streaming = new Set<string>();
  /** Tool calls still running. */
  private tools = new Set<string>();
  /** The commands of the bash calls still running, by item. */
  private commands = new Map<string, string>();

  /** Turns one event into changes to the chat, and what else it meant. */
  event(e: Rec): { ops: ChatOp[]; signal: RpcSignal } {
    const ops: ChatOp[] = [];
    const signal: RpcSignal = {};
    switch (e.type) {
      case 'agent_start':
        signal.busy = true;
        break;
      case 'agent_settled':
      case 'agent_end':
        // Whatever was still streaming won't any more (an abort leaves it open).
        for (const id of this.streaming) ops.push({ op: 'done', id });
        for (const id of this.tools) ops.push({ op: 'done', id });
        if (e.type === 'agent_settled') signal.busy = false;
        this.streaming.clear();
        this.tools.clear();
        this.commands.clear();
        break;
      case 'message_start': {
        const m = rec(e.message);
        if (m.role === 'assistant') this.turn++;
        if (m.role === 'user') {
          const t = contentText(m.content).trim();
          if (t) ops.push({ op: 'put', item: { id: `u${this.turn}-${Date.now().toString(36)}`, k: 'user', text: t } });
        }
        break;
      }
      case 'message_update': {
        const ev = rec(e.assistantMessageEvent);
        const id = `a${this.turn}-${Number(ev.contentIndex) || 0}`;
        if (ev.type === 'text_start' || ev.type === 'thinking_start') {
          this.streaming.add(id);
          ops.push({ op: 'put', item: { id, k: ev.type === 'text_start' ? 'text' : 'thinking', text: '' } });
        } else if (ev.type === 'text_delta' || ev.type === 'thinking_delta') {
          if (!this.streaming.has(id)) {
            this.streaming.add(id);
            ops.push({ op: 'put', item: { id, k: ev.type === 'text_delta' ? 'text' : 'thinking', text: '' } });
          }
          ops.push({ op: 'add', id, field: 'text', text: text(ev.delta) });
        } else if (ev.type === 'text_end' || ev.type === 'thinking_end') {
          this.streaming.delete(id);
          // The end carries the whole text: it's put in place of the deltas, in case one went missing.
          const content = text(ev.content);
          if (content) ops.push({ op: 'add', id, field: 'text', text: content, replace: true });
          ops.push({ op: 'done', id });
        }
        break;
      }
      case 'tool_execution_start': {
        const name = text(e.toolName);
        const args = argsLine(name, e.args);
        const id = `tool-${text(e.toolCallId)}`;
        this.tools.add(id);
        const command = rec(e.args).command;
        if (name === 'bash' && typeof command === 'string') this.commands.set(id, command);
        ops.push({ op: 'put', item: { id, k: 'tool', name, args, output: '' } });
        signal.tool = name;
        break;
      }
      case 'tool_execution_update': {
        // Pi sends the result so far, not what's new: the item is replaced with its tail.
        const out = contentText(rec(e.partialResult).content);
        if (out) ops.push({ op: 'add', id: `tool-${text(e.toolCallId)}`, field: 'output', text: out, replace: true });
        break;
      }
      case 'tool_execution_end': {
        const out = contentText(rec(e.result).content);
        const id = `tool-${text(e.toolCallId)}`;
        this.tools.delete(id);
        ops.push({ op: 'add', id, field: 'output', text: out, replace: true }, { op: 'done', id, error: e.isError === true || undefined });
        const command = this.commands.get(id);
        this.commands.delete(id);
        if (command !== undefined) signal.ran = { command, output: out };
        break;
      }
      case 'extension_ui_request': {
        const method = text(e.method);
        const id = text(e.id);
        if (ASKS.has(method as ChatAskMethod) && id) {
          const options = Array.isArray(e.options) ? e.options.map((o) => (typeof o === 'string' ? o : text(rec(o).label) || text(rec(o).value))).filter(Boolean) : undefined;
          ops.push({ op: 'put', item: { id: `ask-${id}`, k: 'ask', method: method as ChatAskMethod, title: text(e.title) || 'Pi asks', message: text(e.message) || undefined, options, prefill: text(e.prefill) || text(e.placeholder) || undefined } });
          signal.ask = id;
        } else if (method === 'notify') {
          const level = e.notifyType === 'error' ? 'error' : e.notifyType === 'warning' ? 'warn' : 'info';
          ops.push({ op: 'put', item: { id: `n-${id || Date.now().toString(36)}`, k: 'note', text: text(e.message), level } });
        } else if (method === 'setStatus') {
          signal.status = [text(e.statusKey) || 'status', text(e.statusText) || undefined];
        } else if (method === 'setWidget') {
          const lines = Array.isArray(e.widgetLines) ? e.widgetLines.map(text).join('\n') : text(e.widgetLines);
          signal.widget = [text(e.widgetKey) || 'widget', lines || undefined];
        }
        break;
      }
      case 'auto_compaction_start':
      case 'compaction_start':
        ops.push({ op: 'put', item: { id: `c${Date.now().toString(36)}`, k: 'note', text: 'Compacting the conversation…', level: 'info' } });
        break;
      case 'auto_retry_start':
        ops.push({ op: 'put', item: { id: `r${Date.now().toString(36)}`, k: 'note', text: `Retrying: ${text(e.errorMessage) || 'the request failed'}`, level: 'warn' } });
        break;
    }
    return { ops, signal };
  }
}
