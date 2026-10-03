import test from 'node:test';
import assert from 'node:assert/strict';
import { Pacer, targetFps, type PaceState } from '../src/client/features/performance/pace.js';

// How often the office draws (features/performance/pace.ts): slower while idle, unfocused or on battery.

const awake: PaceState = { hidden: false, focused: true, idleMs: 0, busy: false, onBattery: false, cap: 'auto' };

/** Frames the browser offers at `hz` for a second, and how many were drawn. */
function drawn(s: PaceState, hz: number): number {
  const p = new Pacer();
  let n = 0;
  for (let i = 0; i < hz; i++) if (p.shouldDraw(1000 + (i * 1000) / hz, s)) n++;
  return n;
}

test('in use on power, every frame is drawn', () => {
  assert.equal(targetFps(awake), null);
  assert.equal(drawn(awake, 120), 120);
});

test('auto is 30 on battery, at 60 Hz and at 120 Hz', () => {
  const s = { ...awake, onBattery: true };
  assert.equal(drawn(s, 60), 30);
  assert.equal(drawn(s, 120), 30);
});

test('a fixed cap holds whatever the power', () => {
  assert.equal(drawn({ ...awake, cap: '60' }, 120), 60);
  assert.equal(drawn({ ...awake, cap: 'max', onBattery: true }, 120), 120);
});

test('idle drops to 10, unless you are moving', () => {
  const idle = { ...awake, idleMs: 30_000 };
  assert.equal(drawn(idle, 60), 10);
  assert.equal(drawn({ ...idle, busy: true }, 60), 60);
});

test('another window focused: 4; hidden: none', () => {
  assert.equal(drawn({ ...awake, focused: false }, 60), 4);
  assert.equal(drawn({ ...awake, hidden: true }, 60), 0);
});

test('slowed is only said below 30, so the slow-computer check keeps working at a 30 cap', () => {
  const p = new Pacer();
  p.shouldDraw(0, { ...awake, cap: '30' });
  assert.equal(p.slowed, false);
  p.shouldDraw(100, { ...awake, idleMs: 30_000 });
  assert.equal(p.slowed, true);
});
