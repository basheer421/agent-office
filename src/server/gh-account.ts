// Which of the office's GitHub accounts gh acts as on a project's repo. gh can be signed in to
// several accounts at once (a work one and a personal one) and always uses the active one, which
// may not be the one with rights to the repo. This picks the one that does and hands back its
// token as GH_TOKEN for that gh child alone: it never runs `gh auth switch`, which would change the
// account for everything else on the machine.
import { runCli } from './cli/run.js';

/** The account picked for a repo, and the environment that has gh act as it. */
export interface GhAccount {
  login: string;
  env: Record<string, string>;
}

/** The repo a project's gh commands resolve to, from its git remotes. */
export interface RemoteRepo {
  host: string;
  owner: string;
  name: string;
}

async function out(bin: string, args: string[], cwd: string, env?: Record<string, string>): Promise<string | undefined> {
  try {
    const r = await runCli(bin, args, { cwd, env, timeout: 15_000 });
    return r.code === 0 ? r.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** owner/name out of a GitHub remote URL (https, ssh or scp-like), or undefined. */
export function parseRemote(url: string): RemoteRepo | undefined {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? { host: m[1].toLowerCase(), owner: m[2], name: m[3] } : undefined;
}

/**
 * The repo gh picks in `dir`, the way gh does: the remote marked `gh-resolved` by
 * `gh repo set-default`, else upstream, github, origin, then the rest.
 */
export async function remoteRepo(dir: string): Promise<RemoteRepo | undefined> {
  const listed = await out('git', ['remote', '-v'], dir);
  if (!listed) return undefined;
  const urls = new Map<string, string>();
  for (const line of listed.split('\n')) {
    const [name, url, kind] = line.split(/\s+/);
    if (kind === '(fetch)' && name && url) urls.set(name, url);
  }
  const resolved = (await out('git', ['config', '--get-regexp', String.raw`^remote\..*\.gh-resolved$`], dir)) ?? '';
  const base = /^remote\.(.+)\.gh-resolved base$/m.exec(resolved)?.[1];
  const order = [base, 'upstream', 'github', 'origin', ...urls.keys()].filter((n): n is string => n !== undefined && urls.has(n));
  for (const n of order) {
    const r = parseRemote(urls.get(n)!);
    if (r) return r;
  }
  return undefined;
}

/** Whether `env`'s token can push to the repo. */
async function canPush(repo: RemoteRepo, dir: string, env: Record<string, string>): Promise<boolean> {
  return (await out('gh', ['api', `repos/${repo.owner}/${repo.name}`, '--hostname', repo.host, '--jq', '.permissions.push'], dir, env)) === 'true';
}

/**
 * The account gh should act as on `dir`'s repo, when that isn't the active one: the signed-in
 * account named like the repo's owner, else the first that can push to it. Undefined (run gh as
 * it is) when a token is already set in the environment, there's only one account, the active one
 * is the right one, or none of them fits.
 */
export async function pickAccount(dir: string, base: NodeJS.ProcessEnv = process.env): Promise<GhAccount | undefined> {
  if (base.GH_TOKEN || base.GITHUB_TOKEN) return undefined;
  const repo = await remoteRepo(dir);
  if (!repo) return undefined;
  const status = await out('gh', ['auth', 'status', '--hostname', repo.host, '--json', 'hosts'], dir);
  if (!status) return undefined;
  let accounts: { login: string; active: boolean }[];
  try {
    const hosts = JSON.parse(status).hosts?.[repo.host] ?? [];
    accounts = (hosts as { state?: string; login?: string; active?: boolean }[]).flatMap((a) => (a.state === 'success' && a.login ? [{ login: a.login, active: a.active === true }] : []));
  } catch {
    return undefined;
  }
  if (accounts.length < 2) return undefined;
  const envFor = async (login: string) => {
    const token = await out('gh', ['auth', 'token', '--hostname', repo.host, '--user', login], dir);
    if (!token) return undefined;
    const env = Object.fromEntries(Object.entries(base).filter((e): e is [string, string] => e[1] !== undefined));
    env[repo.host === 'github.com' ? 'GH_TOKEN' : 'GH_ENTERPRISE_TOKEN'] = token;
    return env;
  };
  const owner = accounts.find((a) => a.login.toLowerCase() === repo.owner.toLowerCase());
  if (owner) {
    if (owner.active) return undefined;
    const env = await envFor(owner.login);
    return env && { login: owner.login, env };
  }
  // An org's repo: the active account if it can push, else whichever other one can.
  const ordered = [...accounts].sort((a, b) => Number(b.active) - Number(a.active));
  for (const a of ordered) {
    const env = await envFor(a.login);
    if (!env || !(await canPush(repo, dir, env))) continue;
    return a.active ? undefined : { login: a.login, env };
  }
  return undefined;
}
