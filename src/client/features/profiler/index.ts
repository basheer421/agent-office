// A dev-only timing overlay (issue #7): how long each frame phase takes, how often frames are drawn,
// and how many textures go up to the GPU. Off unless the page is opened with `?profile`, or
// `window.__profile(true)` is called from the console; `window.__profileStats()` reads the numbers.
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { TICK_PHASES, type TickPhase } from '../../core/registry';
import { ProfileWindow, type ProfileStats } from './stats';
import './ui.css';

declare global {
  interface Window {
    /** Turns the timing overlay on or off (see installProfiler). */
    __profile?: (on?: boolean) => boolean;
    /** The last second's numbers, or null while it's off. */
    __profileStats?: () => ProfileStats | null;
  }
}

/** Install after the scene is made: it counts uploads on the renderer's GL context. */
export function installProfiler(ctx: Ctx, parts: Pick<Parts, 'stage'>) {
  const stats = new ProfileWindow([...TICK_PHASES]);
  let on = false;
  let el: HTMLElement | null = null;

  // Every texture upload goes through one of these: counting them costs a counter bump.
  const gl = parts.stage.renderer.getContext() as WebGL2RenderingContext;
  for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D'] as const) {
    const real = gl[name] as (...a: unknown[]) => void;
    if (typeof real !== 'function') continue;
    // SAFETY: a WebGL context's methods are plain writable properties; this swaps one for a counting wrapper.
    (gl as unknown as Record<string, unknown>)[name] = function (this: unknown, ...a: unknown[]) {
      if (on) stats.upload();
      return real.apply(this, a);
    };
  }

  const timed = (phase: TickPhase, ms: number) => stats.phase(phase, ms);
  ctx.ticks.add('pre', ({ now }) => {
    if (!on) return;
    if (stats.frame(now)) draw();
  });

  function draw() {
    const s = stats.last;
    if (!el || !s) return;
    const rows = Object.entries(s.phases)
      .sort((a, b) => b[1] - a[1])
      .map(([p, ms]) => `${p.padEnd(9)}${ms.toFixed(2).padStart(7)} ms`);
    el.textContent = [`${s.fps.toFixed(0)} fps  ticks ${s.ticksMs.toFixed(2)} ms`, `uploads/s ${s.uploads}`, ...rows].join('\n');
  }

  function set(want = !on) {
    on = want;
    ctx.ticks.timed = on ? timed : null;
    stats.reset();
    if (on && !el) {
      el = document.createElement('pre');
      el.className = 'profiler';
      document.body.append(el);
    } else if (!on && el) {
      el.remove();
      el = null;
    }
    return on;
  }

  window.__profile = set;
  window.__profileStats = () => (on ? stats.last : null);
  if (new URLSearchParams(location.search).has('profile')) set(true);
}
