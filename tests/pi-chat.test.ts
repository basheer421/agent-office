// Pi chat mode (#47): Pi's --mode rpc events turned into the office's chat, and the chat log both
// ends keep. No Pi install needed: the events below are the shapes `pi --mode rpc` prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RpcChat, itemsOfMessages } from '../src/server/workers/rpc-events.js';
import { ChatLog, CHAT_OUTPUT_MAX } from '../src/shared/chatlog.js';

function run(events: Record<string, unknown>[]) {
  const chat = new RpcChat();
  const log = new ChatLog();
  const signals = events.map((e) => {
    const { ops, signal } = chat.event(e);
    for (const op of ops) log.apply(op);
    return signal;
  });
  return { log, signals };
}

test('a turn: prompt, streamed text, a bash call, done', () => {
  const { log, signals } = run([
    { type: 'agent_start' },
    { type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'list files' }] } },
    { type: 'message_start', message: { role: 'assistant', content: [] } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Sure, ' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'looking.' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Sure, looking.' } },
    { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } },
    { type: 'tool_execution_update', toolCallId: 't1', partialResult: { content: [{ type: 'text', text: 'a' }] } },
    { type: 'tool_execution_end', toolCallId: 't1', result: { content: [{ type: 'text', text: 'a\nb' }] }, isError: false },
    { type: 'agent_end' },
    { type: 'agent_settled' },
  ]);
  assert.deepEqual(
    log.items.map((i) => i.k),
    ['user', 'text', 'tool'],
  );
  const [user, text, tool] = log.items;
  assert.equal(user.k === 'user' && user.text, 'list files');
  assert.ok(text.k === 'text' && text.text === 'Sure, looking.' && text.done);
  assert.ok(tool.k === 'tool' && tool.name === 'bash' && tool.output === 'a\nb' && tool.done && !tool.error);
  assert.equal(signals[0].busy, true);
  assert.equal(signals.at(-1)!.busy, false);
  assert.equal(signals[7].tool, 'bash');
  assert.deepEqual(signals[9].ran, { command: 'ls', output: 'a\nb' });
});

test('a failed tool is marked, and an aborted stream is closed at agent_end', () => {
  const { log } = run([
    { type: 'message_start', message: { role: 'assistant', content: [] } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'half' } },
    { type: 'tool_execution_start', toolCallId: 'x', toolName: 'read', args: { path: 'nope' } },
    { type: 'tool_execution_end', toolCallId: 'x', result: { content: [{ type: 'text', text: 'ENOENT' }] }, isError: true },
    { type: 'agent_end' },
  ]);
  const text = log.get('a1-0');
  const tool = log.get('tool-x');
  assert.ok(text?.k === 'text' && text.done && text.text === 'half');
  assert.ok(tool?.k === 'tool' && tool.error);
});

test('extension UI: a question becomes an ask, status lines and widgets go to the footer', () => {
  const { log, signals } = run([
    { type: 'extension_ui_request', id: 'q1', method: 'select', title: 'Pick one', options: ['a', 'b'] },
    { type: 'extension_ui_request', id: 'n1', method: 'notify', message: 'careful', notifyType: 'warning' },
    { type: 'extension_ui_request', id: 's1', method: 'setStatus', statusKey: 'git', statusText: 'main' },
    { type: 'extension_ui_request', id: 'w1', method: 'setWidget', widgetKey: 'todo', widgetLines: ['1', '2'] },
  ]);
  const ask = log.get('ask-q1');
  assert.ok(ask?.k === 'ask' && ask.method === 'select');
  assert.deepEqual(ask.k === 'ask' && ask.options, ['a', 'b']);
  assert.equal(signals[0].ask, 'q1');
  const note = log.get('n-n1');
  assert.ok(note?.k === 'note' && note.level === 'warn');
  assert.deepEqual(signals[2].status, ['git', 'main']);
  assert.deepEqual(signals[3].widget, ['todo', '1\n2']);
});

test('a resumed conversation comes back from get_messages', () => {
  const items = itemsOfMessages([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'pwd' } }] },
    { role: 'toolResult', toolCallId: 'c1', content: [{ type: 'text', text: '/x' }], isError: false },
  ]);
  const kinds = items.map((i) => i.k);
  assert.deepEqual(kinds.slice(0, 2), ['user', 'text']);
  assert.ok(items.every((i) => i.k === 'user' || i.k === 'note' || i.done));
});

test('the log keeps a tool output tail and drops the oldest items past its limit', () => {
  const log = new ChatLog(3);
  log.put({ id: 't', k: 'tool', name: 'bash', args: '', output: '' });
  log.apply({ op: 'add', id: 't', field: 'output', text: 'x'.repeat(CHAT_OUTPUT_MAX + 50) + 'END' });
  const t = log.get('t');
  assert.ok(t?.k === 'tool' && t.output.endsWith('END') && t.output.length <= CHAT_OUTPUT_MAX + 10);
  for (let i = 0; i < 4; i++) log.put({ id: `u${i}`, k: 'user', text: String(i) });
  assert.equal(log.items.length, 3);
  assert.equal(log.get('t'), undefined);
});
