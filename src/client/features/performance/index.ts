// Drawing less when it doesn't show: the frame pacing (pace.ts) and the graphics quality, both from
// ⚙️ Settings' Graphics (ui/settings-graphics.ts).
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { Pacer, pixelRatioFor, type PaceState } from './pace';

export interface Performance {
  /** Whether to draw the frame the browser offers at `now`. */
  pace(now: number): boolean;
  /** Frames are coming slowly on purpose, so a slow frame rate says nothing about this computer. */
  slowed(): boolean;
}

/** Installed before the scene is made (the frame loop needs it), so `parts.stage` is only read once frames come. */
export function installPerformance(ctx: Ctx, parts: Pick<Parts, 'stage'>): Performance {
  const pacer = new Pacer();
  let lastInput = performance.now();
  let focused = document.hasFocus();
  let onBattery = false;
  const touched = () => {
    lastInput = performance.now();
  };
  for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) window.addEventListener(type, touched, { capture: true, passive: true });
  // Only a pointer that actually moved: Firefox keeps firing still ones (under pointer lock and
  // otherwise), which kept the office out of its idle pace for good (#28).
  window.addEventListener('pointermove', (e) => (e.movementX || e.movementY) && touched(), { capture: true, passive: true });
  window.addEventListener('focus', () => {
    focused = true;
    touched();
  });
  window.addEventListener('blur', () => {
    focused = false;
  });
  document.addEventListener('visibilitychange', touched);
  type Battery = EventTarget & { charging: boolean };
  void (navigator as Navigator & { getBattery?: () => Promise<Battery> })
    .getBattery?.()
    .then((b) => {
      const read = () => {
        onBattery = !b.charging;
      };
      read();
      b.addEventListener('chargingchange', read);
    })
    .catch(() => {});

  // The quality: full (outlines, up to a retina screen's pixels within a budget, see pixelRatioFor) or
  // low (no outlines, one pixel per CSS pixel). Looked at again when the window's size or screen changes.
  let quality: string | null = null;
  function applyQuality() {
    const want = `${ctx.settings.quality} ${window.devicePixelRatio} ${window.innerWidth}x${window.innerHeight}`;
    if (want === quality) return;
    quality = want;
    const low = ctx.settings.quality === 'low';
    parts.stage.effect.enabled = !low;
    const ratio = pixelRatioFor(window.devicePixelRatio, window.innerWidth, window.innerHeight, low);
    if (ratio !== ctx.renderer.getPixelRatio()) ctx.renderer.setPixelRatio(ratio);
  }

  // Calm weather (or the building only, see features/lite-world): a clear sky for you alone (the sky's preview, see Sky.show), so no rain to draw or hear.
  let calm = false;
  function applyWeather() {
    const want = ctx.settings.weather === 'calm' || ctx.settings.world === 'lite';
    if (want === calm) return;
    calm = want;
    ctx.sky.show(want ? { weather: 'clear', intensity: 0 } : {});
  }

  return {
    pace(now) {
      applyQuality();
      applyWeather();
      const { player } = ctx;
      const state: PaceState = {
        hidden: document.hidden,
        focused,
        idleMs: now - lastInput,
        busy: player.moving || !player.grounded,
        onBattery,
        cap: ctx.settings.fps,
      };
      return pacer.shouldDraw(now, state);
    },
    slowed: () => pacer.slowed,
  };
}
