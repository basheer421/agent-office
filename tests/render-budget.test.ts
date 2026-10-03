// The sun's shadow map is redrawn when the sun turns, and on a cadence otherwise (core/render-budget.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShadowCadence } from '../src/client/core/render-budget';

test('the first frame bakes the shadows, then every other frame', () => {
  const c = new ShadowCadence(2, 0.01);
  const sun = new THREE.Vector3(0, 1, 1);
  assert.deepEqual([1, 2, 3, 4, 5].map(() => c.due(sun)), [true, false, true, false, true]);
});

test('the sun turning redraws at once; a nudge under the threshold waits its turn', () => {
  const c = new ShadowCadence(10, 0.01);
  const sun = new THREE.Vector3(0, 1, 1);
  assert.equal(c.due(sun), true);
  assert.equal(c.due(sun.clone().multiplyScalar(3)), false, 'the same way, only longer');
  assert.equal(c.due(new THREE.Vector3(0.001, 1, 1)), false);
  assert.equal(c.due(new THREE.Vector3(0.2, 1, 1)), true);
});

test('dirty forces the next frame', () => {
  const c = new ShadowCadence(10, 0.01);
  const sun = new THREE.Vector3(0, 1, 0);
  c.due(sun);
  c.dirty();
  assert.equal(c.due(sun), true);
});
