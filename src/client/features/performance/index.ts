// Drawing less when it doesn't show: the frame pacing (pace.ts) and the graphics quality, both from
// ⚙️ Settings' Graphics (ui/settings-graphics.ts).
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { Pacer, type PaceState } from './pace';

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
  for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const) window.addEventListener(type, touched, { capture: true, passive: true });
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

  // The quality: full (outlines, up to a retina screen's pixels) or low (no outlines, one pixel per CSS pixel).
  let quality: string | null = null;
  function applyQuality() {
    const want = ctx.settings.quality;
    if (want === quality) return;
    quality = want;
    const low = want === 'low';
    parts.stage.effect.enabled = !low;
    ctx.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
  }

  // Calm weather: a clear sky for you alone (the sky's preview, see Sky.show), so no rain to draw or hear.
  let calm = false;
  function applyWeather() {
    const want = ctx.settings.weather === 'calm';
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
