// Contract test for the ClickUp tracker against a fake ClickUp API (recorded JSON): every request it
// makes must be one the test expects, the answers must map to the neutral model, and the only writes
// are the ones a person makes from the board (comment, status, close, new task), signed with their name.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClickUpTracker, LIST_PREFIX } from '../src/server/trackers/clickup/index.js';
import { trackerFor, trackerChanged, type IssueTracker } from '../src/server/trackers/index.js';
import { setOverrides, overrides } from '../src/server/projects/store.js';
import { clickupPrompts } from '../src/shared/clickup-prompt.js';

const task = (id: string, page: number, extra: Record<string, unknown> = {}) => ({
  id,
  custom_id: null,
  name: `Task ${id}`,
  text_content: `Body of ${id}`,
  status: { status: 'to do', type: 'open' },
  url: `https://app.clickup.com/t/${id}`,
  creator: { username: 'Bachir' },
  assignees: [{ username: 'Haben' }],
  tags: [{ name: 'infra', tag_bg: '#ff0000' }],
  list: { id: 'L1', name: page ? 'Backlog' : 'Sprint 4' },
  date_created: '1759449600000',
  date_updated: '1759453200000',
  ...extra,
});

const requests: { url: string; auth?: string; method?: string; body?: Record<string, unknown> }[] = [];
const statuses = [
  { status: 'complete', type: 'closed', color: '#00ff00', orderindex: 3 },
  { status: 'to do', type: 'open', color: '#d3d3d3', orderindex: 0 },
  { status: 'in progress', type: 'custom', color: '#4194f6', orderindex: 1 },
  { status: 'shipped', type: 'done', color: '#ff00ff', orderindex: 2 },
];
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
  requests.push({ url: req.url!, auth: req.headers.authorization, method: req.method, body });
  const u = new URL(req.url!, 'http://x');
  const send = (body: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'POST' && u.pathname === '/task/abc1/comment') return send({ id: 4567, hist_id: 'h', date: 1759460400000 });
  if (req.method === 'PUT' && u.pathname === '/task/abc1') return send(task('abc1', 0, { status: { status: body?.status, type: 'custom' } }));
  if (req.method === 'POST' && /^\/list\/(L1|L9)\/task$/.test(u.pathname)) return send(task('new1', 0, { name: body?.name, text_content: body?.description, list: { id: u.pathname.split('/')[2], name: 'Sprint 4' } }));
  if (req.method !== 'GET') return send({ err: 'unexpected write' }, 405);
  if (u.pathname === '/list/L1') return send({ id: 'L1', statuses });
  if (u.pathname === '/space/901/folder') return send({ folders: [{ id: 'F1', name: 'Dev', lists: [{ id: 'L1', name: 'Sprint 4' }] }] });
  if (u.pathname === '/space/901/list') return send({ lists: [{ id: 'L2', name: 'Loose' }] });
  if (u.pathname === '/team') return send({ teams: [{ id: '90182300300', name: 'G137' }] });
  if (u.pathname === '/team/90182300300/space') return send({ spaces: [{ id: '901', name: 'Brain' }, { id: '902', name: 'Infra' }] });
  if (u.pathname === '/team/90182300300/task') {
    const page = Number(u.searchParams.get('page'));
    if (page === 0) return send({ tasks: Array.from({ length: 100 }, (_, i) => task(i ? `t${i}` : 'abc1', 0, i ? {} : { custom_id: 'BRN-7' })), last_page: false });
    return send({ tasks: [task('last', 1, { tags: [] })], last_page: true });
  }
  if (u.pathname === '/task/abc1') return send(task('abc1', 0, { custom_id: 'BRN-7' }));
  if (u.pathname === '/task/abc1/comment') return send({ comments: [{ id: 'c2', comment_text: 'second', user: { username: 'Haben' }, date: '1759453200000' }, { id: 'c1', comment_text: 'first', user: { username: 'Bachir' }, date: '1759449600000' }] });
  if (u.pathname === '/task/nope') return send({ err: 'Task not found' }, 404);
  send({ err: 'unexpected' }, 500);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
after(() => server.close());
process.env.CLICKUP_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.CLICKUP_API_TOKEN = 'pk_test';
delete process.env.CLICKUP_TEAM_ID;

test('lists a space’s open tasks, page by page, with its list and tags as labels', async () => {
  requests.length = 0;
  const items = await new ClickUpTracker('901').list();
  assert.equal(items.length, 101);
  const first = items[0];
  assert.equal(first.id, 'abc1');
  assert.equal(first.ref, 'BRN-7');
  assert.equal(first.state, 'OPEN');
  assert.equal(first.url, 'https://app.clickup.com/t/abc1');
  assert.deepEqual(first.assignees, ['Haben']);
  assert.equal(first.createdAt, '2025-10-03T00:00:00.000Z');
  assert.deepEqual(first.labels.map((l) => l.name), [`${LIST_PREFIX}Sprint 4`, 'infra']);
  assert.equal(items[100].labels[0].name, `${LIST_PREFIX}Backlog`);
  assert.equal(items[100].ref, 'last');
  const taskCalls = requests.filter((r) => r.url.startsWith('/team/90182300300/task'));
  assert.equal(taskCalls.length, 2);
  const q = new URL(taskCalls[0].url, 'http://x').searchParams;
  assert.deepEqual(q.getAll('space_ids[]'), ['901']);
  assert.equal(q.get('include_closed'), 'false');
  assert.ok(requests.every((r) => r.method === 'GET' && r.auth === 'pk_test'));
});

test('detail has the body and the comments oldest first; a missing task is an error', async () => {
  const t = new ClickUpTracker('901');
  const d = await t.detail('abc1');
  assert.equal(d.body, 'Body of abc1');
  assert.deepEqual(d.comments.map((c) => [c.author, c.body]), [['Bachir', 'first'], ['Haben', 'second']]);
  await assert.rejects(t.detail('nope'), /no such/);
});

test('never assigns (a worker taking a task writes nothing), and the reference names the task with its link', async () => {
  const t: IssueTracker = new ClickUpTracker('901');
  assert.deepEqual(t.caps, { comment: true, close: true, assign: false, labels: false, status: true, create: true });
  assert.equal(t.assignSelf, undefined);
  assert.equal(t.labels, undefined);
  const [it] = await t.list();
  assert.deepEqual(t.reference(it), { text: 'ClickUp task BRN-7', closing: 'ClickUp task BRN-7: https://app.clickup.com/t/abc1', url: it.url });
  const p = clickupPrompts.work({ ref: it.ref, title: it.title, url: it.url });
  assert.match(p, /ClickUp task BRN-7: https:\/\/app\.clickup\.com\/t\/abc1/);
  assert.doesNotMatch(p, /gh issue/);
});

test('no token: a clear error, not a request', async () => {
  const saved = process.env.CLICKUP_API_TOKEN;
  delete process.env.CLICKUP_API_TOKEN;
  try {
    await assert.rejects(new ClickUpTracker('901').list(), /CLICKUP_API_TOKEN/);
  } finally {
    process.env.CLICKUP_API_TOKEN = saved;
  }
});

test('a floor follows the ClickUp space picked in its project settings', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-clickup-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  mkdirSync(path.join(dir, '.agent-office'), { recursive: true });
  const floor = trackerFor(dir, 'gitlab');
  assert.equal(floor.kind, 'none');
  await assert.rejects(floor.list(), /ClickUp space/);
  assert.equal(setOverrides(dir, { clickupSpace: '../901' }), `ClickUp space "../901" isn't a space id (a number, from the space's URL)`);
  assert.equal(setOverrides(dir, { clickupSpace: '901' }), undefined);
  assert.deepEqual(overrides(dir), { clickupSpace: '901' });
  trackerChanged();
  assert.equal(floor.kind, 'clickup');
  assert.equal((await floor.list()).length, 101);
  writeFileSync(path.join(dir, '.agent-office', 'project.json'), '{}');
  trackerChanged();
  assert.equal(floor.kind, 'none');
});

test('comments are signed with the name of whoever clicked', async () => {
  requests.length = 0;
  const c = await new ClickUpTracker('901').comment('abc1', 'Looks done', undefined, 'Bachir');
  assert.equal(c.id, '4567');
  assert.equal(c.body, 'Looks done\n\n— Bachir, from Agent Office');
  assert.deepEqual(requests.map((r) => [r.method, r.url]), [['POST', '/task/abc1/comment']]);
  assert.deepEqual(requests[0].body, { comment_text: 'Looks done\n\n— Bachir, from Agent Office', notify_all: false });
  assert.equal(requests[0].auth, 'pk_test');
});

test('statuses are the task list’s, in order; setting one PUTs it', async () => {
  const t = new ClickUpTracker('901');
  assert.deepEqual((await t.statuses('abc1')).map((s) => [s.name, s.type]), [['to do', 'open'], ['in progress', 'custom'], ['shipped', 'done'], ['complete', 'closed']]);
  requests.length = 0;
  await t.setStatus('abc1', 'in progress');
  assert.deepEqual(requests.map((r) => [r.method, r.url, r.body]), [['PUT', '/task/abc1', { status: 'in progress' }]]);
  assert.equal((await t.list())[0].status, 'to do');
});

test('closing moves it to the closed status, after a signed comment saying why', async () => {
  requests.length = 0;
  await new ClickUpTracker('901').close('abc1', { reason: 'not planned', comment: 'dup of BRN-3' }, undefined, 'Haben');
  const writes = requests.filter((r) => r.method !== 'GET');
  assert.deepEqual(writes.map((r) => [r.method, r.url]), [['POST', '/task/abc1/comment'], ['PUT', '/task/abc1']]);
  assert.equal(writes[0].body?.comment_text, 'Closed as not planned.\n\ndup of BRN-3\n\n— Haben, from Agent Office');
  assert.deepEqual(writes[1].body, { status: 'complete' });
});

test('a new task goes in the default list: the one picked, else the space’s first', async () => {
  requests.length = 0;
  const it = await new ClickUpTracker('901').create({ title: 'Rotate keys', body: 'Before Friday' }, 'Bachir');
  assert.equal(it.title, 'Rotate keys');
  assert.equal(it.body, 'Before Friday\n\n— Created by Bachir, from Agent Office');
  const post = requests.find((r) => r.method === 'POST')!;
  assert.equal(post.url, '/list/L1/task');
  requests.length = 0;
  await new ClickUpTracker('901', 'L9').create({ title: 'x', body: '' }, 'Bachir');
  assert.deepEqual(requests.map((r) => [r.method, r.url]), [['POST', '/list/L9/task']]);
});

test('project settings keep a default list only with its space', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-clickup-list-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  assert.equal(setOverrides(dir, { clickupList: '55' }), undefined);
  assert.deepEqual(overrides(dir), {});
  assert.equal(setOverrides(dir, { clickupSpace: '901', clickupList: 'x/1' }), `ClickUp list "x/1" isn't a list id (a number)`);
  assert.equal(setOverrides(dir, { clickupSpace: '901', clickupList: '55' }), undefined);
  assert.deepEqual(overrides(dir), { clickupSpace: '901', clickupList: '55' });
});
