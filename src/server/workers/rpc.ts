// A Pi worker in chat mode (WorkerInfo.chat): no PTY, the office drives `pi --mode rpc` over stdin
// and stdout instead and keeps the worker's chat (see shared/protocol/agentchat.ts), which browsers
// draw themselves. What it does is also written into the worker's headless terminal as a plain
// transcript, so its desk screen, its terminal window and the raw view still show something.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { ChatLog } from '../../shared/chatlog.js';
import type { ChatFooter, ChatOp, ChatSendMode, ChatServerMsg } from '../../shared/protocol.js';
import { RpcChat, itemsOfMessages } from './rpc-events.js';
import type { HeadlessTerminal } from './terminal.js';
import type { AgentSession, Worker, WorkerContext, WorkerHandle } from './types.js';
import { truncate } from './util.js';

/** The most of its stdout one line may hold: agent_end carries the whole conversation. */
const MAX_LINE = 16 * 1024 * 1024;
/** Changes to a chat go out together, at most this often. */
const OPS_EVERY_MS = 60;
/** Its status lines and widgets change about once a second while it's idle: they go out at most this often. */
const FOOTER_EVERY_MS = 1000;
/** How long a command waits for its response. */
const COMMAND_MS = 15_000;

/** Colours and the like in its status lines and widgets, which the chat window draws as plain text. */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
/** Text for the terminal: no escapes of its own, and its lines ended the way a terminal wants. */
const plain = (s: string) => s.replace(/\x1b/g, '␛').replace(/\r?\n/g, '\r\n');

interface RpcLaunch {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt?: string;
  resumed: boolean;
}

export class PiRpcSession implements AgentSession {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<string, (r: Record<string, unknown>) => void>();
  private reducer = new RpcChat();
  private ops: ChatOp[] = [];
  private opsTimer?: NodeJS.Timeout;
  private footerTimer?: NodeJS.Timeout;
  private status = new Map<string, string>();
  private widgets = new Map<string, string>();
  private asks = new Set<string>();
  private busy = false;
  private closing = false;
  /** What's been typed into its terminal (the raw view), sent as a prompt on Enter. */
  private line = '';
  private stderr = '';

  constructor(
    private ctx: WorkerContext,
    private w: Worker,
    private h: WorkerHandle,
    private term: HeadlessTerminal,
    private launch: RpcLaunch,
  ) {}

  private get live(): boolean {
    return this.w.dsh === this && this.ctx.workers.get(this.w.info.id) === this.w;
  }

  private get chat() {
    return (this.w.chat ??= { log: new ChatLog(), footer: { busy: false, status: [], widgets: [] } });
  }

  start() {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.launch.file, this.launch.args, { cwd: this.launch.cwd, env: this.launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      this.exited(-1, (err as Error).message);
      return;
    }
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.read(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-4000)));
    child.stdin.on('error', () => {});
    child.on('error', (err) => this.exited(-1, err.message));
    child.on('exit', (code) => this.exited(code, this.stderr.trim() || undefined));
    void this.boot();
  }

  /** Its session id, and on a resume the conversation so far; then its first message. */
  private async boot() {
    const state = await this.command({ type: 'get_state' });
    if (!this.live) return;
    const data = (state?.data ?? {}) as Record<string, unknown>;
    if (typeof data.sessionId === 'string' && data.sessionId !== this.w.info.sessionId) {
      this.w.info.sessionId = data.sessionId;
      this.h.persist();
    }
    if (this.launch.resumed || !this.chat.log.items.length) {
      const messages = await this.command({ type: 'get_messages' });
      if (!this.live) return;
      const items = itemsOfMessages((messages?.data as Record<string, unknown> | undefined)?.messages);
      if (items.length || !this.chat.log.items.length) {
        this.chat.log.reset(items);
        this.broadcast({ t: 'chat.snapshot', workerId: this.w.info.id, items: this.chat.log.items, footer: this.chat.footer });
      }
    }
    // Up and waiting for a prompt, unless it was given one.
    this.h.bootBlocked = false;
    if (this.launch.prompt) this.send(this.launch.prompt, 'prompt');
    else if (!this.busy) this.h.setStatus('idle');
  }

  private read(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE) this.buffer = this.buffer.slice(this.buffer.lastIndexOf('\n') + 1);
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const raw = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      if (!raw.trim()) continue;
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!e || typeof e !== 'object') continue;
      if (e.type === 'response') {
        const id = String(e.id ?? '');
        const done = this.pending.get(id);
        this.pending.delete(id);
        done?.(e);
        if (!done && e.success === false && typeof e.error === 'string') this.note(e.error, 'error');
        continue;
      }
      if (this.live) this.event(e);
    }
  }

  private event(e: Record<string, unknown>) {
    const { ops, signal } = this.reducer.event(e);
    if (ops.length) this.apply(ops);
    if (signal.busy !== undefined) {
      this.busy = signal.busy;
      this.footerChanged();
      if (!this.asks.size) this.h.setStatus(signal.busy ? 'working' : 'idle');
    }
    if (signal.tool) this.h.noteTool(signal.tool);
    if (signal.ran) this.h.notePr(signal.ran.command, signal.ran.output);
    if (signal.ask) {
      this.asks.add(signal.ask);
      this.h.setStatus('needs_input');
    }
    if (signal.status) this.setLine(this.status, signal.status);
    if (signal.widget) this.setLine(this.widgets, signal.widget);
  }

  private setLine(map: Map<string, string>, [key, value]: [string, string | undefined]) {
    if (map.get(key) === value) return;
    if (value === undefined) map.delete(key);
    else map.set(key, truncate(value.replace(ANSI, ''), 400));
    this.footerChanged();
  }

  /** Applies changes to its chat, writes what's finished into its terminal, and sends them on. */
  private apply(ops: ChatOp[]) {
    const { log } = this.chat;
    for (const op of ops) {
      const item = log.apply(op);
      if (!item) continue;
      this.ops.push(op);
      if (op.op === 'put' && item.k === 'user') this.write(`\r\n\x1b[36m› ${plain(item.text)}${RESET}\r\n`);
      else if (op.op === 'put' && item.k === 'tool') this.write(`${DIM}⏺ ${item.name} ${plain(truncate(item.args, 200))}${RESET}\r\n`);
      else if (op.op === 'put' && item.k === 'ask') this.write(`\x1b[33m? ${plain(item.title)}${RESET}\r\n`);
      else if (op.op === 'put' && item.k === 'note') this.write(`${DIM}${plain(item.text)}${RESET}\r\n`);
      else if (op.op === 'done' && item.k === 'text' && item.text) this.write(`${plain(item.text)}\r\n`);
      else if (op.op === 'done' && item.k === 'tool' && item.error) this.write(`\x1b[31m  ✗ ${plain(truncate(item.output.trim().split('\n').pop() ?? '', 200))}${RESET}\r\n`);
    }
    if (this.ops.length && !this.opsTimer) this.opsTimer = setTimeout(() => this.flush(), OPS_EVERY_MS);
  }

  /** Sends what's changed now: before a snapshot goes out, which already has it. */
  flush() {
    clearTimeout(this.opsTimer);
    this.opsTimer = undefined;
    const ops = this.ops;
    this.ops = [];
    if (ops.length) this.broadcast({ t: 'chat.ops', workerId: this.w.info.id, ops });
  }

  private footerChanged() {
    if (this.footerTimer) return;
    this.footerTimer = setTimeout(() => {
      this.footerTimer = undefined;
      const footer: ChatFooter = { busy: this.busy, status: [...this.status.values()], widgets: [...this.widgets.values()] };
      const was = this.chat.footer;
      if (JSON.stringify(was) === JSON.stringify(footer)) return;
      this.chat.footer = footer;
      this.broadcast({ t: 'chat.footer', workerId: this.w.info.id, footer });
    }, FOOTER_EVERY_MS);
  }

  private broadcast(msg: ChatServerMsg) {
    if (this.w.viewers.size) this.ctx.events.chat(msg, [...this.w.viewers.keys()]);
  }

  private write(text: string) {
    this.term.write(text);
    this.w.screenDirty = true;
    this.w.unsaved = true;
    if (this.w.viewers.size) this.ctx.events.data(this.w.info.id, text, [...this.w.viewers.keys()]);
  }

  private note(text: string, level: 'info' | 'warn' | 'error') {
    this.apply([{ op: 'put', item: { id: `n${Date.now().toString(36)}${this.nextId++}`, k: 'note', text, level } }]);
  }

  private command(cmd: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const id = `o${this.nextId++}`;
    return new Promise((resolve) => {
      if (!this.child?.stdin.writable) return resolve(undefined);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(undefined);
      }, COMMAND_MS);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.child.stdin.write(`${JSON.stringify({ ...cmd, id })}\n`);
    });
  }

  /** A message for it: a prompt when it's waiting, else steering it now or queued for after its turn. */
  send(text: string, mode: ChatSendMode = 'prompt') {
    const type = mode !== 'prompt' ? mode : this.busy ? 'follow_up' : 'prompt';
    // The user message comes back as message_start once it's taken: steered and queued ones only show then.
    void this.command({ type, message: text }).then((r) => {
      if (r && r.success === false) this.note(`Pi didn't take that: ${String(r.error ?? 'it said no')}`, 'error');
    });
    if (type === 'prompt') {
      this.busy = true;
      this.h.setStatus('working');
    }
  }

  abort() {
    void this.command({ type: 'abort' });
  }

  /** An answer to one of its asks, from whoever is at the desk. */
  answer(askId: string, reply: { value?: string; confirmed?: boolean; cancelled?: boolean }): string | undefined {
    if (!this.asks.delete(askId)) return 'That question was already answered';
    const res = reply.cancelled ? { cancelled: true } : reply.confirmed !== undefined ? { confirmed: reply.confirmed } : { value: reply.value ?? '' };
    this.child?.stdin.write(`${JSON.stringify({ type: 'extension_ui_response', id: askId, ...res })}\n`);
    const item = this.chat.log.get(`ask-${askId}`);
    if (item?.k === 'ask') {
      const answer = reply.cancelled ? '(dismissed)' : reply.confirmed !== undefined ? (reply.confirmed ? 'Yes' : 'No') : reply.value || '(empty)';
      this.apply([{ op: 'put', item: { ...item, answer: truncate(answer, 2000), done: true } }]);
    }
    if (!this.asks.size) this.h.setStatus(this.busy ? 'working' : 'idle');
    return undefined;
  }

  /** Keystrokes in its terminal: a line, sent as a prompt on Enter; Esc stops its turn. */
  writeInput(data: string) {
    if (data === '\x1b') return this.abort();
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const text = this.line.trim();
        this.line = '';
        this.write('\r\n');
        if (text) this.prompt(text);
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.line) {
          this.line = this.line.slice(0, -1);
          this.write('\b \b');
        }
      } else if (ch >= ' ') {
        this.line += ch;
        this.write(ch);
      }
    }
  }

  prompt(text: string) {
    this.send(text);
  }

  close() {
    this.closing = true;
    clearTimeout(this.opsTimer);
    this.flush();
    try {
      this.child?.stdin.end();
      this.child?.kill();
    } catch {
      // already gone
    }
  }

  /** Its process ended: while the office is up, its desk says so and R resumes it. */
  private exited(code: number | null, error?: string) {
    if (this.w.dsh !== this) return; // closed by the office, or replaced
    this.w.dsh = undefined;
    clearTimeout(this.opsTimer);
    this.flush();
    for (const done of this.pending.values()) done({ success: false });
    this.pending.clear();
    if (this.closing || this.ctx.closing || this.ctx.workers.get(this.w.info.id) !== this.w) return;
    const { info } = this.w;
    if (error && code) this.note(`Pi: ${truncate(error.replace(/\s+/g, ' '), 400)}`, 'error');
    if (error && !info.sessionId) this.ctx.events.toast(`Could not start ${info.name} in chat mode: ${truncate(error, 200)}`, 'error');
    this.note(`${info.name} exited with code ${code ?? -1}${info.sessionId ? ' — press R to resume' : ''}`, 'info');
    this.flush();
    this.busy = false;
    this.chat.footer = { busy: false, status: [], widgets: [] };
    this.broadcast({ t: 'chat.footer', workerId: info.id, footer: this.chat.footer });
    info.exitCode = code ?? -1;
    info.status = 'exited';
    this.ctx.emit(this.w);
    this.ctx.persist();
  }
}

/** Starts (or resumes) a chat-mode Pi worker: what the manager calls in place of spawning its PTY. */
export function launchRpc(ctx: WorkerContext, w: Worker, h: WorkerHandle, term: HeadlessTerminal, options: RpcLaunch) {
  const session = new PiRpcSession(ctx, w, h, term, options);
  w.dsh = session;
  session.start();
}

/** The chat-mode worker `id`'s session, while it runs. */
export function rpcOf(ctx: WorkerContext, id: string): PiRpcSession | undefined {
  const s = ctx.workers.get(id)?.dsh;
  return s instanceof PiRpcSession ? s : undefined;
}
