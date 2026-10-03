// Projects as folders on the office's machine: 📂 Open folder (browsing, opening one as a floor),
// the roots it may look in, and each floor's ⚙️ Project settings.
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { FolderEntry, ProjectClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { ProjectRoots, tildify } from '../../projects/roots.js';
import { effective, setOverrides } from '../../projects/store.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

const rootsOf = new WeakMap<Ctx, ProjectRoots>();
/** The office's roots and GitLab hosts (one per office). */
export function projectRoots(ctx: Ctx): ProjectRoots {
  let r = rootsOf.get(ctx);
  if (!r) rootsOf.set(ctx, (r = new ProjectRoots(ctx.cfg.dataDir)));
  return r;
}

const isGit = (dir: string) => existsSync(path.join(dir, '.git'));

export const projectHandlers = {
  'project.browse'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can open folders as floors');
    const roots = projectRoots(ctx);
    const where = msg.path ? str(msg.path, 1024) : roots.roots[0];
    const r = roots.resolveInside(where);
    if ('error' in r) return ctx.sendTo(c, { t: 'project.listing', path: where, roots: roots.roots, entries: [], error: r.error });
    const floors = ctx.building.list();
    let entries: FolderEntry[] = [];
    try {
      entries = readdirSync(r.dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => {
          const full = path.join(r.dir, e.name);
          return { name: e.name, git: isGit(full), floor: floors.find((f) => path.resolve(f.dir) === full)?.name };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 500);
    } catch (err) {
      return ctx.sendTo(c, { t: 'project.listing', path: tildify(r.dir), roots: roots.roots, entries: [], error: (err as Error).message });
    }
    const up = path.dirname(r.dir);
    const parent = up !== r.dir && !('error' in roots.resolveInside(up)) ? tildify(up) : undefined;
    ctx.sendTo(c, { t: 'project.listing', path: tildify(r.dir), parent, roots: roots.roots, entries, git: isGit(r.dir) });
  },
  'project.open'(ctx, c, msg) {
    const who = c.peer.name;
    const raw = str(msg.dir, 1024);
    if (!ctx.meOf(c.accountId).admin) return ctx.sendTo(c, { t: 'project.opened', dir: raw, error: 'Only admins can open folders as floors' });
    const r = projectRoots(ctx).resolveInside(raw);
    if ('error' in r) return ctx.sendTo(c, { t: 'project.opened', dir: raw, error: r.error });
    const def = ctx.building.openFolder(r.dir, who);
    if (typeof def === 'string') return ctx.sendTo(c, { t: 'project.opened', dir: raw, error: def });
    const floor = ctx.openFloor(def);
    ctx.floorsChanged();
    if (!floor) return ctx.sendTo(c, { t: 'project.opened', dir: raw, error: `Couldn't open ${def.name}'s floor — see the office's log` });
    console.log(`  ${who} opened ${def.dir} as a floor`);
    ctx.toastAll(`🛗 New floor: ${def.name}, opened by ${who}`);
    ctx.sendTo(c, { t: 'project.opened', dir: raw, floor: floor.id });
  },
  'project.config'(ctx, c, msg) {
    const floor = ctx.floors.get(str(msg.floor, 64));
    if (!floor) return ctx.sendTo(c, { t: 'project.config', floor: msg.floor, error: 'No such floor' });
    ctx.sendTo(c, { t: 'project.config', floor: floor.id, config: effective(floor.def.dir, projectRoots(ctx).gitlabHosts) });
  },
  'project.configure'(ctx, c, msg) {
    const floor = ctx.floors.get(str(msg.floor, 64));
    if (!floor) return ctx.warn(c, 'No such floor');
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change project settings');
    const o = msg.overrides ?? {};
    const err = setOverrides(floor.def.dir, { pushRemote: o.pushRemote ? str(o.pushRemote, 200) : undefined, baseBranch: o.baseBranch ? str(o.baseBranch, 200) : undefined }, projectRoots(ctx).gitlabHosts);
    if (err) return ctx.sendTo(c, { t: 'project.config', floor: floor.id, error: err });
    ctx.toastAll(`⚙️ ${c.peer.name} changed ${floor.def.name}'s project settings`);
    ctx.sendTo(c, { t: 'project.config', floor: floor.id, config: effective(floor.def.dir, projectRoots(ctx).gitlabHosts) });
  },
  'project.roots'(ctx, c, msg) {
    const roots = projectRoots(ctx);
    if (msg.state) {
      if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change where projects open from');
      const err = roots.set(msg.state);
      if (err) return ctx.warn(c, err);
    }
    ctx.sendTo(c, { t: 'project.roots', state: roots.view() });
  },
} satisfies HandlerMap<ProjectClientMsg>;
