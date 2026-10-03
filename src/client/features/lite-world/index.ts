// 🏢 Building only (⚙️ Settings' Graphics, ui/settings-graphics.ts): no city round the roof, no cars,
// no scenic loop, no weather and no holiday props. None of them is drawn or ticked while it's on: their
// updates are wrapped here to skip (lite.ts), so the parts that own them don't need to know about it.
// The weather is kept clear by features/performance, as Always clear does.
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { skipWhile, veil } from './lite';

export interface LiteWorld {
  /** Whether the world is down to the building. */
  lite(): boolean;
}

/** Further out than this from the middle of the building, you're out on the scenic loop. */
const OUT_ON_THE_LOOP = 40;

export function installLiteWorld(ctx: Ctx, parts: Pick<Parts, 'stage' | 'rooftop' | 'cars' | 'place'>): LiteWorld {
  const lite = () => ctx.settings.world === 'lite';
  const { office } = ctx;
  const { holiday } = parts.stage;
  skipWhile(office.cars, 'update', lite);
  skipWhile(office.scenic, 'update', lite);
  skipWhile(office.scenic, 'cull', lite);
  skipWhile(holiday, 'update', lite);
  const veils = [veil(office.cars.group), veil(office.scenic.group), veil(holiday.group)];

  let was = false;
  ctx.ticks.add('pre', () => {
    const now = lite();
    // The roof is built the first time anyone goes up: its city is wrapped and veiled once it is.
    const city = parts.rooftop.roof()?.city;
    if (city) {
      skipWhile(city, 'update', lite);
      const v = veil(city.group);
      if (!veils.includes(v)) veils.push(v);
    }
    if (now && !was) leaveTheOutside();
    for (const v of veils) v.visible = !now;
    if (now !== was) for (const car of office.cars.cars) car.interactable.off = now;
    was = now;
  });

  /** Out of the car you're in, and back off the scenic loop, before they stop being kept up. */
  function leaveTheOutside() {
    if (parts.cars.driver.active) parts.cars.getOut(true);
    const { pos } = ctx.player;
    if (ctx.inOffice() && !ctx.upTop() && Math.hypot(pos.x, pos.z) > OUT_ON_THE_LOOP) parts.place.placeAtSpawn();
  }
  return { lite };
}
