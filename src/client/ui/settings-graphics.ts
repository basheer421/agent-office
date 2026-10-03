// ⚙️ Settings' Graphics, under You: the frame rate cap and the quality (see features/performance).
import { FPS_CAPS, type FpsCap, type Settings } from '../state/persist';
import { h } from './dom';
import { choiceRow } from './settings-rows';

const FPS_LABELS: Record<FpsCap, string> = { auto: '🔋 Auto', '30': '30 fps', '60': '60 fps', max: 'Display' };

export function graphicsSetting(get: () => Settings, change: (some: Partial<Settings>) => void, frame: (body: Node[]) => HTMLElement): HTMLElement {
  const fps = choiceRow<FpsCap>('Frame rate', FPS_CAPS.map((c) => [c, FPS_LABELS[c]] as const), () => get().fps, (fps) => change({ fps }));
  const quality = choiceRow<Settings['quality']>('Quality', [['high', '✨ Full'], ['low', '🪶 Light']], () => get().quality, (quality) => change({ quality }));
  return frame([
    fps,
    quality,
    h('p.setting-note', {}, 'Auto draws 30 frames a second on battery and as fast as your screen on power. Whatever you pick, the office slows to 10 after 20 seconds without a key or the mouse, and to 4 while another window has the focus. Light drops the outlines and draws one pixel per screen point, which is far easier on a laptop’s graphics.'),
  ]);
}
