// Laptop screens go only to the pages that want them (see 'screens.watch'), and one a page starts
// watching again comes with a full frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { sendScreen } from '../src/server/office/screens.js';
import { screenHandlers, screenHooks } from '../src/server/ws/handlers/screens.js';
import type { Client } from '../src/server/office/client.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Floor } from '../src/server/floor.js';
import type { ServerMsg } from '../src/shared/protocol.js';

type Screen = Extract<ServerMsg, { t: 'screen' }>;
const frame = { cols: 2, rows: 1, lines: { 0: [['hi', -1, -1, 0]] }, cursor: [0, 0] } as unknown as Omit<Screen, 't' | 'workerId' | 'full'>;
const msg = (workerId: string): Screen => ({ t: 'screen', workerId, ...frame, full: false });

function office() {
  const floor = { id: 'f1', workers: { fullScreens: () => ['a', 'b', 'c'].map((workerId) => ({ workerId, frame })) } } as unknown as Floor;
  const got = new Map<string, Screen[]>();
  const client = (id: string, at = 'f1') => {
    got.set(id, []);
    const ws = { readyState: WebSocket.OPEN, bufferedAmount: 0, send: (j: string) => got.get(id)!.push(JSON.parse(j)) };
    return { id, ws, peer: { floor: at } } as unknown as Client;
  };
  const clients = new Map<string, Client>();
  const ctx = {
    clients,
    floorOf: (c: Client) => (c.peer.floor === floor.id ? floor : undefined),
    sendTo: (c: Client, m: ServerMsg) => c.ws.send(JSON.stringify(m)),
  } as unknown as Ctx;
  return { ctx, floor, got, clients, client };
}

test('a page that never says sends every screen on its floor, and none from other floors', () => {
  const { ctx, floor, got, clients, client } = office();
  clients.set('p', client('p'));
  clients.set('q', client('q', 'f2'));
  sendScreen(ctx, floor, msg('a'));
  sendScreen(ctx, floor, msg('b'));
  assert.deepEqual(got.get('p')!.map((m) => m.workerId), ['a', 'b']);
  assert.equal(got.get('q')!.length, 0);
});

test('only watched screens stream; one watched again gets a full frame; hidden (empty) gets nothing', () => {
  const { ctx, floor, got, clients, client } = office();
  const p = client('p');
  clients.set('p', p);
  screenHandlers['screens.watch'](ctx, p, { t: 'screens.watch', workerIds: ['a'] });
  // Going from "everything" to a set sends no catch-up: it had them all.
  assert.equal(got.get('p')!.length, 0);
  for (const id of ['a', 'b', 'c']) sendScreen(ctx, floor, msg(id));
  assert.deepEqual(got.get('p')!.map((m) => m.workerId), ['a']);
  got.set('p', []);
  screenHandlers['screens.watch'](ctx, p, { t: 'screens.watch', workerIds: ['a', 'b'] });
  assert.deepEqual(got.get('p')!.map((m) => [m.workerId, m.full]), [['b', true]]);
  got.set('p', []);
  screenHandlers['screens.watch'](ctx, p, { t: 'screens.watch', workerIds: [] });
  for (const id of ['a', 'b', 'c']) sendScreen(ctx, floor, msg(id));
  assert.equal(got.get('p')!.length, 0);
  screenHandlers['screens.watch'](ctx, p, { t: 'screens.watch', workerIds: ['a', 'b'] });
  assert.deepEqual(got.get('p')!.map((m) => [m.workerId, m.full]), [['a', true], ['b', true]]);
});

test('leaving a floor goes back to every screen until the page says again', () => {
  const { ctx, floor, got, clients, client } = office();
  const p = client('p');
  clients.set('p', p);
  screenHandlers['screens.watch'](ctx, p, { t: 'screens.watch', workerIds: [] });
  screenHooks.leaving!(ctx, p, floor);
  sendScreen(ctx, floor, msg('c'));
  assert.deepEqual(got.get('p')!.map((m) => m.workerId), ['c']);
});

test('junk from the page is ignored', () => {
  const { ctx, client } = office();
  const p = client('p');
  screenHandlers['screens.watch'](ctx, p, { t: 'screens.watch', workerIds: 'a' as unknown as string[] });
  assert.equal(p.screens, undefined);
});
