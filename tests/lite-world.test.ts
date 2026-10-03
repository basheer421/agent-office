// 🏢 Building only's pieces (src/client/features/lite-world/lite.ts): skipping a part's updates while
// it's on, and hiding a part without touching its own visibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { skipWhile, veil } from '../src/client/features/lite-world/lite.js';

test('a wrapped update is skipped only while Building only is on, and wrapping twice is once', () => {
  let on = false;
  let calls = 0;
  const part = {
    n: 1,
    update(by: number) {
      calls += by * this.n;
    },
  };
  skipWhile(part, 'update', () => on);
  skipWhile(part, 'update', () => on);
  part.update(1);
  on = true;
  part.update(1);
  on = false;
  part.update(2);
  assert.equal(calls, 3);
});

test("a veiled part hides and comes back while its own visibility stays whoever's", () => {
  const scene = new THREE.Group();
  const holiday = new THREE.Group();
  scene.add(holiday);
  const v = veil(holiday);
  assert.equal(veil(holiday), v);
  assert.equal(holiday.parent, v);
  assert.equal(v.parent, scene);
  // Travel hides the props while Building only is on: once it's off, they stay hidden.
  v.visible = false;
  holiday.visible = false;
  v.visible = true;
  assert.equal(holiday.visible, false);
  holiday.visible = true;
  v.visible = false;
  assert.equal(holiday.visible, true);
  let seen = true;
  holiday.traverseVisible(() => void (seen = false));
  scene.traverseVisible((o) => void (o === holiday && (seen = true)));
  assert.equal(seen, false);
});
