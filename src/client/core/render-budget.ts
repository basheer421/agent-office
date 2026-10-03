/**
 * Game-style savings on drawing the office (issue #21): shaders compiled up front instead of on first
 * look, and the sun's shadow map redrawn only when it has to be, instead of every frame. What the
 * renderer drew last frame (draw calls, triangles) is on `window.__renderStats()`, to measure them by.
 */
import * as THREE from 'three';
import { store } from '../state';
import type { Ctx } from './context';
import type { Parts } from './parts';

/** The sun turning more than this (radians, about a quarter of a degree) has its shadows redrawn at once. */
const SUN_TURN = 0.0045;
/** Otherwise the shadows are redrawn every this many frames, so people and things moving keep theirs. */
const SHADOW_EVERY = 2;

/** What one frame took to draw, from `renderer.info` (every pass: the scene, its outlines, the hands). */
export interface RenderStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  /** Shadow-map redraws in the last 60 frames. */
  shadowRedraws: number;
}

declare global {
  interface Window {
    /** What the last frame took to draw (see installRenderBudget). */
    __renderStats?: () => RenderStats;
  }
}

/** Whether the shadow map needs redrawing this frame: the sun turned, or its turn on the cadence came round. */
export class ShadowCadence {
  private last = new THREE.Vector3();
  private frame = 0;
  private baked = false;

  constructor(private every = SHADOW_EVERY, private turn = SUN_TURN) {}

  /** `dir` is the way the sun shines from (needn't be normalized). */
  due(dir: THREE.Vector3): boolean {
    const d = dir.lengthSq() > 0 ? dir.clone().normalize() : dir;
    this.frame++;
    const turned = !this.baked || d.angleTo(this.last) > this.turn;
    if (turned || this.frame >= this.every) {
      this.last.copy(d);
      this.baked = true;
      this.frame = 0;
      return true;
    }
    return false;
  }

  /** Redraw on the next frame whatever (a floor came in, things moved about wholesale). */
  dirty() {
    this.baked = false;
  }
}

/** Shader warmup, the shadow cadence and the stats. Install after the scene is made. */
export function installRenderBudget(ctx: Ctx, parts: Pick<Parts, 'stage'>) {
  const { renderer, scene, camera, sun } = parts.stage;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  // One frame's worth across every pass, not just the last render call.
  renderer.info.autoReset = false;

  const cadence = new ShadowCadence();
  const dir = new THREE.Vector3();
  const redraws: boolean[] = [];
  let stats: RenderStats = { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0, shadowRedraws: 0 };

  ctx.ticks.add('pre', () => {
    const { render, memory, programs } = renderer.info;
    const shadowRedraws = redraws.filter(Boolean).length;
    stats = { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, programs: programs?.length ?? 0, shadowRedraws };
    renderer.info.reset();
  });
  // Before the render phase, where the frame is drawn (core/loop.ts).
  ctx.ticks.add('hud', () => {
    dir.subVectors(sun.position, sun.target.position);
    const due = cadence.due(dir);
    if (due) renderer.shadowMap.needsUpdate = true;
    redraws.push(due);
    if (redraws.length > 60) redraws.shift();
  });

  /** Every material in the scene compiled now, off the main thread where the browser can, so a first look doesn't hitch. */
  async function warm() {
    try {
      await renderer.compileAsync(scene, camera);
    } catch (err) {
      // Not fatal: anything left uncompiled compiles on first sight, as it always did.
      console.error('shader warmup', err);
    }
  }
  void warm();
  // A floor brings its own things in: compile theirs once it's built, and redraw the shadows for them.
  store.on('floor', () => {
    cadence.dirty();
    requestAnimationFrame(() => void warm());
  });

  window.__renderStats = () => stats;
  return { stats: () => stats, warm };
}
