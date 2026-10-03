// Pi over its RPC mode (`pi --mode rpc`): JSON commands on stdin, typed JSONL events on stdout. The
// office holds the child and draws what it says into the worker's terminal itself, as it does for
// DeepSeek Harness over ACP (see dsh.ts and workers/acp.ts), so the desk, the terminal window and
// /lite keep working while a chat view is built on the same events (issue #47).
//
// Pi's raw events are large (message_start/end carry whole messages, agent_end the whole
// conversation) and its extensions send status/widget updates about once a second. None of that is
// forwarded: this file reads what it needs off each event and drops the rest.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { toolAction } from '../shared/actions.js';
import type { Usage } from '../shared/protocol.js';
import type { DshEvents } from './dsh.js';
import type { AgentSession } from './workers/types.js';

export type PiRpcEvents = DshEvents;

export interface PiRpcLaunch {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Sent as the first prompt once Pi has said which session it's on. */
  firstPrompt?: string;
  /** What the session had spent before this run, when it's resumed: Pi only reports each call's own. */
  usage?: Usage;
}

const ESC = '\x1b[';
const C = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  you: `${ESC}38;2;122;170;255m`,
  ok: `${ESC}38;2;34;197;94m`,
  warn: `${ESC}38;2;245;158;11m`,
  bad: `${ESC}38;2;242;90;90m`,
  tool: `${ESC}38;2;207;211;214m`,
};

/** Bounds on everything read off the wire, so a chatty agent can't grow a terminal. */
const MAX_FRAME = 8_000_000;
const MAX_LINE = 2000;
const MAX_TYPED = 20_000;
const MAX_OPTIONS = 20;
const MAX_TOOL_LINES = 6;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Text safe to write to a terminal: no escape sequences or other controls of its own, newlines as CRLF. */
export function termText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Whole sequences first (CSI, OSC), so none of one is left behind as text.
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\n/g, '\r\n');
}

function oneLine(text: string, max = MAX_LINE): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function notice(color: string, text: string): string {
  return `${color}● ${termText(oneLine(text))}${C.reset}\r\n`;
}

/** The one line a tool call is shown as: its name and what it was asked, the way Pi's TUI shows it. */
export function toolLine(name: string, args: unknown): string {
  const a = isRec(args) ? args : {};
  const detail = str(a.command) ?? str(a.path) ?? str(a.file_path) ?? str(a.pattern) ?? str(a.url) ?? str(a.query) ?? (Object.keys(a).length ? JSON.stringify(a) : '');
  return `${name}${detail ? ` ${oneLine(detail, 200)}` : ''}`;
}

/** The text of a tool's result (`{ content: [{ type: 'text', text }] }`), as far as there is any. */
function resultText(result: unknown): string {
  if (!isRec(result) || !Array.isArray(result.content)) return '';
  return result.content.map((c) => (isRec(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('\n');
}

/** The office's Usage for a session so far, from each assistant message's own usage. */
export function addUsage(total: Usage | undefined, usage: unknown, model?: string): Usage {
  const u = isRec(usage) ? usage : {};
  const cost = isRec(u.cost) ? num(u.cost.total) : 0;
  const t = total ?? { input: 0, output: 0, reasoning: 0, cacheWrite: 0, cacheRead: 0, cost: 0, costKnown: true, calls: 0, callsKnown: true };
  return {
    ...t,
    input: t.input + num(u.input),
    output: t.output + num(u.output),
    reasoning: (t.reasoning ?? 0) + num(u.reasoning),
    cacheWrite: t.cacheWrite + num(u.cacheWrite),
    cacheRead: t.cacheRead + num(u.cacheRead),
    cost: t.cost + cost,
    calls: t.calls + 1,
    ...(model ? { model } : {}),
  };
}

/** A question an extension asked (select, confirm, input, editor), waiting on the person at the desk. */
interface Asked {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor';
  options: string[];
}

/** One Pi worker's RPC connection, behind the same face as a DeepSeek Harness session. */
export class PiRpcSession implements AgentSession {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private line = '';
  private asked?: Asked;
  private busy = false;
  /** Where the transcript stands: mid-line in text or thinking, or at the start of a line. */
  private mode: 'line' | 'text' | 'thinking' = 'line';
  private usage?: Usage;
  private started = false;
  private finished = false;
  private closing = false;

  constructor(
    private launch: PiRpcLaunch,
    private events: PiRpcEvents,
  ) {
    this.usage = launch.usage;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.launch.file, this.launch.args, { cwd: this.launch.cwd, env: this.launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      this.finished = true;
      this.events.exit(-1, err instanceof Error ? err.message : String(err), false);
      return;
    }
    this.child = child;
    this.events.status('starting');
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.read(chunk));
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4000)));
    child.on('error', (err) => this.finish(-1, err.message));
    child.on('exit', (code) => this.finish(code, stderr.trim() || undefined));
    // Which session it's on (a new one, or the --session-id it was resumed with) comes back first.
    this.send({ id: 'state', type: 'get_state' });
    if (this.launch.firstPrompt) this.prompt(this.launch.firstPrompt);
  }

  /** Keystrokes from a browser: echoed, buffered to a line, submitted on Enter. */
  writeInput(data: string): void {
    if (this.finished || !this.started) return;
    if (data === '\x1b') return this.cancelTurn();
    const cleaned = data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1bO[@-~]/g, '');
    let echo = '';
    const flush = () => {
      if (echo) this.events.output(echo);
      echo = '';
    };
    for (const ch of cleaned) {
      if (ch === '\r' || ch === '\n') {
        flush();
        this.submitLine();
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.line) {
          this.line = [...this.line].slice(0, -1).join('');
          echo += '\b \b';
        }
      } else if (ch === '\x03') {
        flush();
        this.cancelTurn();
      } else if (ch < ' ' || /[\x80-\x9f\u202a-\u202e\u2066-\u2069]/.test(ch)) continue;
      else if (this.line.length < MAX_TYPED) {
        this.line += ch;
        echo += ch;
      }
    }
    flush();
  }

  /** A prompt from the office (the prompt box, the queue): mid-turn it steers the turn instead. */
  prompt(text: string): void {
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean || this.finished) return;
    this.newLine();
    this.events.output(`${C.you}${C.bold}>${C.reset} ${termText(clean).replace(/\r\n/g, '\r\n  ')}\r\n`);
    if (this.busy) this.send({ type: 'steer', message: clean });
    else {
      this.busy = true;
      this.events.status('working');
      this.send({ type: 'prompt', message: clean });
    }
  }

  /** Escape / Ctrl+C: an open question is cancelled, else the turn in flight is aborted. */
  cancelTurn(): void {
    if (this.finished) return;
    if (this.asked) {
      this.answer({ cancelled: true });
      return;
    }
    if (this.busy) {
      this.newLine();
      this.events.output(notice(C.dim, 'aborting'));
      this.send({ type: 'abort' });
      return;
    }
    this.line = '';
    this.events.output('\r\n');
  }

  close(): void {
    if (this.closing || this.finished) return;
    this.closing = true;
    const child = this.child;
    try {
      child?.stdin.end();
    } catch {
      // already gone
    }
    setTimeout(() => {
      try {
        child?.kill('SIGTERM');
      } catch {
        // already gone
      }
    }, 500).unref?.();
  }

  // --- what the person typed -------------------------------------------------

  private submitLine(): void {
    const text = this.line;
    this.line = '';
    this.events.output('\r\n');
    const asked = this.asked;
    if (asked) {
      const typed = text.trim();
      if (asked.method === 'confirm') {
        if (/^(y|yes|1)$/i.test(typed)) this.answer({ confirmed: true });
        else if (/^(n|no|2)$/i.test(typed)) this.answer({ confirmed: false });
        else this.events.output(notice(C.warn, 'answer y or n (Esc cancels)'));
      } else if (asked.method === 'select') {
        const n = Number(typed);
        const choice = Number.isInteger(n) && n >= 1 && n <= asked.options.length ? asked.options[n - 1] : asked.options.find((o) => o.toLowerCase() === typed.toLowerCase());
        if (choice) this.answer({ value: choice });
        else this.events.output(notice(C.warn, `pick 1–${asked.options.length} (Esc cancels)`));
      } else this.answer({ value: text });
      return;
    }
    if (!text.trim()) return;
    // The line is already on screen: send it without echoing it again.
    const clean = text.trim();
    this.events.prompted(clean);
    if (this.busy) this.send({ type: 'steer', message: clean });
    else {
      this.busy = true;
      this.events.status('working');
      this.send({ type: 'prompt', message: clean });
    }
  }

  private answer(reply: { value: string } | { confirmed: boolean } | { cancelled: true }): void {
    const asked = this.asked;
    if (!asked) return;
    this.asked = undefined;
    this.send({ type: 'extension_ui_response', id: asked.id, ...reply });
    if ('cancelled' in reply) this.events.output(notice(C.dim, 'cancelled'));
    this.events.status(this.busy ? 'working' : 'idle');
  }

  // --- what Pi says ------------------------------------------------------------

  private read(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      // Pi frames on LF alone: U+2028/2029 inside a JSON string are not line ends.
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) break;
      const frame = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      if (!frame.trim()) continue;
      let event: unknown;
      try {
        event = JSON.parse(frame);
      } catch {
        continue; // not an event (something an extension printed): skip it
      }
      if (isRec(event)) this.dispatch(event);
    }
    if (this.buffer.length > MAX_FRAME) this.buffer = '';
  }

  /** One event from Pi. */
  private dispatch(e: Rec): void {
    switch (e.type) {
      case 'response':
        return this.onResponse(e);
      case 'agent_start':
        this.busy = true;
        this.events.status('working');
        return;
      case 'message_update':
        return this.onDelta(isRec(e.assistantMessageEvent) ? e.assistantMessageEvent : {});
      case 'message_end':
        return this.onMessageEnd(isRec(e.message) ? e.message : {});
      case 'tool_execution_start': {
        const name = str(e.toolName) ?? 'tool';
        this.newLine();
        this.events.output(`${C.tool}${C.bold}●${C.reset} ${C.tool}${termText(toolLine(name, e.args))}${C.reset}\r\n`);
        this.events.action(toolAction(name, e.args));
        return;
      }
      case 'tool_execution_end': {
        const lines = resultText(e.result).replace(/\s+$/, '').split('\n').filter((l, i, all) => l || i < all.length - 1);
        const shown = lines.slice(0, MAX_TOOL_LINES).map((l) => `  ${C.dim}${termText(oneLine(l, 200))}${C.reset}`);
        if (lines.length > MAX_TOOL_LINES) shown.push(`  ${C.dim}… ${lines.length - MAX_TOOL_LINES} more lines${C.reset}`);
        const mark = e.isError ? `  ${C.bad}✗ failed${C.reset}` : '';
        this.events.output([...shown, mark].filter(Boolean).map((l) => `${l}\r\n`).join(''));
        if (e.isError) this.events.action('failing');
        return;
      }
      case 'auto_retry_start':
        this.newLine();
        this.events.output(notice(C.warn, `retrying: ${str(e.errorMessage) ?? 'error'}`));
        return;
      case 'compaction_start':
        this.newLine();
        this.events.output(notice(C.dim, 'compacting context'));
        return;
      case 'agent_settled':
        this.newLine();
        this.busy = false;
        this.events.action(undefined);
        this.events.status(this.asked ? 'needs_input' : 'done');
        return;
      case 'extension_ui_request':
        return this.onUiRequest(e);
      // agent_end, turn_*, message_start, tool_execution_update: nothing to draw.
    }
  }

  private onResponse(e: Rec): void {
    if (e.command === 'get_state' && e.success && isRec(e.data)) {
      const id = str(e.data.sessionId);
      if (id) this.events.session(id);
      if (!this.busy) this.events.status('idle');
      return;
    }
    if (e.success === false) {
      this.newLine();
      this.events.output(notice(C.bad, `${str(e.command) ?? 'command'}: ${str(e.error) ?? 'failed'}`));
      if (e.command === 'prompt') {
        this.busy = false;
        this.events.status('idle');
      }
    }
  }

  private onDelta(d: Rec): void {
    const delta = typeof d.delta === 'string' ? d.delta : '';
    if (d.type === 'text_delta' && delta) {
      if (this.mode === 'thinking') this.newLine();
      this.mode = 'text';
      this.events.output(termText(delta));
    } else if (d.type === 'thinking_delta' && delta) {
      if (this.mode === 'text') this.newLine();
      if (this.mode !== 'thinking') this.events.output(`${C.dim}│ `);
      this.mode = 'thinking';
      this.events.output(`${C.dim}${termText(delta).replace(/\r\n/g, `\r\n│ `)}${C.reset}`);
    }
  }

  private onMessageEnd(m: Rec): void {
    if (m.role !== 'assistant') return;
    this.newLine();
    if (m.stopReason === 'error') this.events.output(notice(C.bad, str(m.errorMessage) ?? 'the model returned an error'));
    else if (m.stopReason === 'aborted') this.events.output(notice(C.dim, 'stopped'));
    if (isRec(m.usage)) {
      this.usage = addUsage(this.usage, m.usage, str(m.model));
      this.events.usage(this.usage);
    }
  }

  private onUiRequest(e: Rec): void {
    const id = str(e.id);
    const method = e.method;
    if (method === 'notify') {
      this.newLine();
      this.events.output(notice(e.notifyType === 'error' ? C.bad : e.notifyType === 'warning' ? C.warn : C.dim, str(e.message) ?? ''));
      return;
    }
    if (!id || (method !== 'select' && method !== 'confirm' && method !== 'input' && method !== 'editor')) return; // status, widgets, title
    // A new question replaces one still open: Pi times the old one out on its side.
    const options = method === 'select' && Array.isArray(e.options) ? e.options.filter((o): o is string => typeof o === 'string').slice(0, MAX_OPTIONS) : [];
    this.asked = { id, method, options };
    this.newLine();
    const out = [`${C.warn}${C.bold}?${C.reset} ${C.bold}${termText(oneLine(str(e.title) ?? 'Pi asks'))}${C.reset}`];
    if (method === 'confirm') out.push(`  ${termText(oneLine(str(e.message) ?? ''))}`, `  ${C.dim}y / n · Esc cancels${C.reset}`);
    if (method === 'select') out.push(...options.map((o, i) => `  ${C.bold}${i + 1}${C.reset} ${termText(oneLine(o, 200))}`), `  ${C.dim}type a number · Esc cancels${C.reset}`);
    if (method === 'input' || method === 'editor') out.push(`  ${C.dim}type an answer, Enter sends · Esc cancels${C.reset}`);
    this.events.output(out.map((l) => `${l}\r\n`).join(''));
    this.events.status('needs_input');
  }

  /** Ends whatever line the transcript is on, so the next thing starts at the left edge. */
  private newLine(): void {
    if (this.mode !== 'line') this.events.output(`${C.reset}\r\n`);
    this.mode = 'line';
  }

  private send(message: Rec): void {
    const child = this.child;
    if (!child || this.finished || !child.stdin.writable) return;
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      // the exit handler reports a broken pipe
    }
  }

  private finish(code: number | null, error?: string): void {
    if (this.finished) return;
    this.finished = true;
    this.child = undefined;
    this.events.exit(code, error, this.closing);
  }
}
