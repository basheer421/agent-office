// ⬇️ Clone from GitLab: the projects the office's glab sign-in belongs to on the first of ⚙️'s GitLab
// hosts, and cloning one (git over ssh) into the workspace folder as <host>/<group>/…/<name>, which
// then opens as a floor where it is, like 📂 Open folder.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { GitLabRepoChoice, ProjectClientMsg } from '../../../shared/protocol.js';
import { cloneGitlab, gitlabProject, gitlabProjects } from '../../hosts/index.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import { detect } from '../../projects/detect.js';
import { projectRoots } from './projects.js';
import type { HandlerMap } from './types.js';

const TTL_MS = 5 * 60_000;
let cache: { host: string; at: number; repos: Promise<GitLabRepoChoice[]> } | undefined;
const cloning = new Set<string>();

const destOf = (ctx: Ctx, host: string, projectPath: string) => path.join(ctx.building.projectsDir, host, ...projectPath.split('/'));

export const gitlabCloneHandlers = {
  'project.gitlabRepos'(ctx, c, msg) {
    const host = projectRoots(ctx).gitlabHosts[0];
    if (!ctx.meOf(c.accountId).admin) return ctx.sendTo(c, { t: 'project.gitlabRepos', host, repos: [], error: 'Only admins can clone projects from GitLab' });
    if (!cache || cache.host !== host || msg.refresh || Date.now() - cache.at > TTL_MS) {
      const repos = gitlabProjects(host, ctx.cfg.dataDir).then((ps) => ps.map(({ path: p, description, activityAt }) => ({ path: p, description, activityAt })));
      cache = { host, at: Date.now(), repos };
      repos.catch(() => cache?.repos === repos && (cache = undefined));
    }
    const floors = ctx.building.list();
    void cache.repos.then(
      (repos) => ctx.sendTo(c, { t: 'project.gitlabRepos', host, repos: repos.map((r) => ({ ...r, floor: floors.find((f) => path.resolve(f.dir) === destOf(ctx, host, r.path))?.name })) }),
      (err: Error) => ctx.sendTo(c, { t: 'project.gitlabRepos', host, repos: [], error: `Couldn't list your GitLab projects with glab on ${host}: ${err.message}` }),
    );
  },
  'project.clone'(ctx, c, msg) {
    const who = c.peer.name;
    const wanted = str(msg.path, 300);
    const reply = (error?: string, floor?: string) => ctx.sendTo(c, { t: 'project.opened', dir: wanted, floor, error });
    if (!ctx.meOf(c.accountId).admin) return reply('Only admins can clone projects from GitLab');
    if (!/^[\w.-]+(\/[\w.-]+)+$/.test(wanted) || wanted.split('/').some((x) => x === '.' || x === '..')) return reply(`"${wanted}" isn't a GitLab project path`);
    const host = projectRoots(ctx).gitlabHosts[0];
    const dest = destOf(ctx, host, wanted);
    if (cloning.has(dest)) return reply(`${wanted} is already being cloned`);
    cloning.add(dest);
    void (async () => {
      // Already there (cloned before, or by hand): open it, as long as it's a checkout of this project.
      if (existsSync(dest)) {
        const d = detect(dest, [host]);
        if (d.projectPath?.toLowerCase() !== wanted.toLowerCase()) return `${dest} already exists and isn't a checkout of ${wanted} — move it out of the way first`;
      } else {
        let sshUrl: string;
        try {
          sshUrl = (await gitlabProject(host, wanted, ctx.cfg.dataDir)).sshUrl;
        } catch (err) {
          return `Couldn't find ${wanted} on ${host}: ${(err as Error).message}`;
        }
        ctx.toastAll(`🛗 ${who} is cloning ${wanted} from ${host}…`);
        const err = await cloneGitlab(sshUrl, dest);
        if (err) return `Couldn't clone ${wanted}: ${err}`;
      }
      const def = ctx.building.openFolder(dest, who);
      if (typeof def === 'string') return def;
      const floor = ctx.openFloor(def);
      ctx.floorsChanged();
      if (!floor) return `Cloned ${wanted}, but couldn't open its floor — see the office's log`;
      console.log(`  ${who} cloned ${host}/${wanted} as a floor (${dest})`);
      ctx.toastAll(`🛗 New floor: ${def.name}, cloned from ${host} by ${who}`);
      reply(undefined, floor.id);
      return undefined;
    })().then(
      (error) => error && reply(error),
      (err: Error) => reply(err.message),
    ).finally(() => cloning.delete(dest));
  },
} satisfies HandlerMap<Extract<ProjectClientMsg, { t: 'project.gitlabRepos' | 'project.clone' }>>;
