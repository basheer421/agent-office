// Pi in chat mode (pi --mode rpc, see src/server/pirpc.ts): a fake Pi below answers the RPC commands
// with the event shapes a real pi 0.87 run emits, so nothing here needs Pi installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PiRpcSession, addUsage, toolLine } from '../src/server/pirpc.ts';
import { piArgs } from '../src/server/pi.ts';
import { Ledger } from '../src/server/usage.ts';
import { WorkerManager } from '../src/server/workers.ts';
import type { Usage, WorkerAction, WorkerInfo, WorkerStatus } from '../src/shared/protocol.ts';

const fakePi = String.raw`import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
if (process.env.PIRPC_FAKE_LOG) appendFileSync(process.env.PIRPC_FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\n');
const at = process.argv.indexOf('--session-id');
const sessionId = at > 0 ? process.argv[at + 1] : 'sess-42';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
// What a real Pi's extensions send while idle: never drawn.
const chatter = setInterval(() => out({ type: 'extension_ui_request', id: 'w', method: 'setWidget', widgetKey: 'background-tasks', widgetLines: ['x'] }), 20);
process.stdout.write('not json, an extension printed this\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'get_state') return out({ id: msg.id, type: 'response', command: 'get_state', success: true, data: { sessionId, isStreaming: false } });
  if (msg.type === 'prompt') {
    out({ id: msg.id, type: 'response', command: 'prompt', success: true });
    out({ type: 'agent_start' });
    out({ type: 'message_start', message: { role: 'user', content: 'x'.repeat(30000) } });
    out({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'npm test' } });
    out({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: { content: [{ type: 'text', text: 'ok 1\nok 2\n' }] }, isError: false });
    out({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' } });
    out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'all \x1b[31mgreen' } });
    out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '\nnext line' } });
    out({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', model: 'fake-model', usage: { input: 2, output: 51, cacheRead: 100, cacheWrite: 0, cost: { total: 0.25 } } } });
    out({ type: 'extension_ui_request', id: 'q1', method: 'select', title: 'Pick a color', options: ['red', 'blue'] });
    return;
  }
  if (msg.type === 'extension_ui_response') {
    out({ type: 'extension_ui_request', id: 'n1', method: 'notify', message: 'picked ' + (msg.value ?? 'nothing') });
    out({ type: 'agent_end', messages: [] });
    out({ type: 'agent_settled' });
    return;
  }
  if (msg.type === 'steer') return out({ type: 'extension_ui_request', id: 'n2', method: 'notify', message: 'steered: ' + msg.message });
});
process.stdin.on('end', () => { clearInterval(chatter); process.exit(0); });
`;

const plain = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '');

async function waitFor<T>(read: () => T, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = read();
    if (ok(v)) return v;
    if (Date.now() > until) throw new Error(`timed out; last value: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('a Pi chat session: session id, tool calls, streamed text, usage, a question answered, a clean exit', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pirpc-'));
  const script = path.join(dir, 'fake-pi.mjs');
  writeFileSync(script, fakePi);
  const s = { output: '', statuses: [] as WorkerStatus[], actions: [] as (WorkerAction | undefined)[], usage: undefined as Usage | undefined, session: '', prompted: [] as string[], exit: undefined as { code: number | null; quiet: boolean } | undefined };
  const session = new PiRpcSession(
    { file: process.execPath, args: [script], cwd: dir, env: process.env, firstPrompt: 'run the tests' },
    {
      output: (t) => (s.output += t),
      status: (st) => s.statuses.push(st),
      action: (a) => s.actions.push(a),
      usage: (u) => (s.usage = u),
      session: (id) => (s.session = id),
      prompted: (t) => s.prompted.push(t),
      exit: (code, _error, quiet) => (s.exit = { code, quiet }),
    },
  );
  try {
    session.start();
    await waitFor(() => s.output, (o) => o.includes('Pick a color'));
    assert.equal(s.session, 'sess-42');
    assert.match(plain(s.output), /> run the tests/);
    assert.match(plain(s.output), /bash npm test/);
    assert.match(plain(s.output), /ok 2/);
    assert.match(plain(s.output), /│ hmm/);
    // Its own escape sequences never reach the terminal, and newlines are CRLF.
    assert.match(plain(s.output), /all green\r\nnext line/);
    assert.ok(!s.output.includes('x'.repeat(100)), 'a message_start body is never drawn');
    assert.ok(!s.output.includes('background-tasks'));
    assert.ok(s.actions.includes('test'), 'npm test acts out testing');
    assert.equal(s.usage?.output, 51);
    assert.equal(s.usage?.cost, 0.25);
    assert.equal(s.usage?.model, 'fake-model');
    assert.equal(s.statuses.at(-1), 'needs_input');

    // Mid-turn, a typed line steers rather than starting a new prompt...
    session.writeInput('h');
    session.writeInput('i');
    session.writeInput('\r');
    // ...except that a question is open, so it's taken as the answer and has to be a choice.
    await waitFor(() => s.output, (o) => o.includes('pick 1–2'));
    session.writeInput('2');
    session.writeInput('\r');
    await waitFor(() => s.output, (o) => o.includes('picked blue'));
    await waitFor(() => s.statuses.at(-1), (st) => st === 'done');
    assert.equal(s.actions.at(-1), undefined);

    // Idle now: a typed line is a prompt, and the task card hears of it.
    session.writeInput('again');
    session.writeInput('\r');
    await waitFor(() => s.prompted, (p) => p.includes('again'));

    session.close();
    await waitFor(() => s.exit, (e) => !!e);
    assert.equal(s.exit?.quiet, true);
  } finally {
    session.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Pi chat command line: rpc mode, no hook extension, no prompt argument, the desk\'s own session', () => {
  const args = piArgs(['--mode', 'json', '--verbose'], { mode: 'rpc', sessionDir: '/d/pi-sessions/w1', sessionId: 'sess-1', model: 'openai/gpt-5', effort: 'high' });
  assert.deepEqual(args, ['--verbose', '--session-dir', '/d/pi-sessions/w1', '--mode', 'rpc', '--session-id', 'sess-1', '--model', 'openai/gpt-5', '--thinking', 'high']);
});

test('Pi chat usage adds up across calls; tool lines say what was asked', () => {
  const one = addUsage(undefined, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.5 } });
  const two = addUsage(one, { input: 1, output: 1, cost: { total: 0.25 } }, 'm');
  assert.deepEqual([two.input, two.output, two.cacheRead, two.cacheWrite, two.cost, two.calls, two.model], [2, 3, 3, 4, 0.75, 2, 'm']);
  assert.equal(toolLine('read', { path: 'src/a.ts' }), 'read src/a.ts');
  assert.equal(toolLine('custom', {}), 'custom');
});

test('the office hires a Pi (chat) worker, takes a prompt and an answer at the desk, and resumes it after a restart', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-office-pirpc-')));
  const data = path.join(root, '.agent-office');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'invocations.jsonl');
  mkdirSync(data, { recursive: true });
  mkdirSync(bin);
  writeFileSync(path.join(root, 'fake-pi.mjs'), fakePi);
  writeFileSync(path.join(bin, 'pi'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(root, 'fake-pi.mjs'))} "$@"\n`);
  chmodSync(path.join(bin, 'pi'), 0o700);
  writeFileSync(log, '');
  const saved = { PATH: process.env.PATH, PIRPC_FAKE_LOG: process.env.PIRPC_FAKE_LOG };
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  process.env.PIRPC_FAKE_LOG = log;
  const make = () => new WorkerManager(root, data, 'claude', [], { url: 'http://127.0.0.1:1', token: '' }, { update() {}, remove() {}, data() {}, screen() {}, toast() {} }, new Ledger(data, { pauseHiring: false }, () => {}, () => {}));
  const first = make();
  let second: WorkerManager | undefined;
  t.after(() => {
    second?.shutdown(false);
    first.shutdown(false);
    process.env.PATH = saved.PATH;
    if (saved.PIRPC_FAKE_LOG === undefined) delete process.env.PIRPC_FAKE_LOG;
    else process.env.PIRPC_FAKE_LOG = saved.PIRPC_FAKE_LOG;
    rmSync(root, { recursive: true, force: true });
  });

  const spawned = first.spawn('desk-1', 'tester', 'run the tests', false, 'agent', 'pi-chat');
  assert.equal(typeof spawned, 'object', typeof spawned === 'string' ? spawned : '');
  const id = (spawned as WorkerInfo).id;
  await waitFor(() => first.get(id)?.status, (s) => s === 'needs_input');
  assert.equal(first.get(id)?.sessionId, 'sess-42');
  assert.equal(first.get(id)?.usage?.cost, 0.25);
  // It ran `pi` in RPC mode in the desk's own session folder, with no hook extension and no prompt argument.
  const argv = (JSON.parse(readFileSync(log, 'utf8').split('\n')[0]) as { argv: string[] }).argv;
  assert.deepEqual(argv.slice(0, 4), ['--session-dir', path.join(data, 'pi-sessions', id), '--mode', 'rpc']);
  assert.ok(!argv.includes('--extension') && !argv.includes('run the tests'));

  // The question is answered from the terminal, and the turn ends at the desk.
  first.write(id, '1\r', 'tester');
  await waitFor(() => first.get(id)?.status, (s) => s === 'done');

  // The office goes down; the next one finds it offline and R carries on the same session, usage and all.
  first.shutdown(true);
  second = make();
  assert.equal(second.get(id)?.status, 'offline');
  assert.equal(second.resume(id), undefined);
  await waitFor(() => readFileSync(log, 'utf8').trim().split('\n').length, (n) => n === 2);
  const resumed = (JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[1]) as { argv: string[] }).argv;
  assert.deepEqual(resumed.slice(resumed.indexOf('--session-id'), resumed.indexOf('--session-id') + 2), ['--session-id', 'sess-42']);
  await waitFor(() => second?.get(id)?.status, (s) => s === 'idle');
  assert.equal(second.get(id)?.usage?.cost, 0.25);
});
