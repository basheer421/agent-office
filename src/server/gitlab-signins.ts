import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GitLabSignInsState, GitLabHostSignIn } from '../shared/protocol.js';
import { gitlabHosts } from './projects/detect.js';
import { effective } from './projects/store.js';
import { quote, run } from './signin-run.js';

/*
 * Everyone's own GitLab
 * ---------------------
 * The GitLab half of signins.ts: in an office with accounts, the office acts on GitLab as the person
 * who clicked (comments, merges, merge requests), and their workers push and run `glab` as them.
 * Each account keeps its own glab config in .agent-office/homes/<id>/glab (GLAB_CONFIG_DIR), signed
 * in to each of ⚙️'s GitLab hosts with a personal access token pasted in the office. Admins may keep
 * using the office machine's own glab.
 */

/** Credentials the office's own environment may carry for glab. None reach anything run as someone else. */
const GITLAB_VARS = ['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'CI_JOB_TOKEN', 'GLAB_CONFIG_DIR', 'GITLAB_HOST', 'GL_HOST'];
/** glpat-…, and the other prefixed or legacy 20-character tokens. */
const GITLAB_TOKEN = /^[A-Za-z0-9_.-]{20,255}$/;
const LOOK_GAP_MS = 20_000;

interface Saved {
  /** The office machine's own glab (admins). Unset: their own, in their folder. */
  use?: 'office';
  /** Who the last look found on each host, so it shows before the next look. */
  seen?: Record<string, string>;
}

interface Live {
  hosts: Record<string, Omit<GitLabHostSignIn, 'host'>>;
  looking?: Promise<void>;
  lookedAt: number;
}

/** The GitLab host a project folder pushes to, when it's one of ⚙️'s GitLab hosts. */
export function gitlabHostOf(dir: string): string | undefined {
  const cfg = effective(dir, gitlabHosts());
  return cfg.host === 'gitlab' ? cfg.hostname : undefined;
}

export class GitLabSignIns {
  private live = new Map<string, Live>();

  constructor(
    /** An account's folder, made on first use (SignIns.prepare). */
    private homeOf: (id: string) => string,
    private glab: string | null,
    private base: () => Record<string, string>,
    private mayUseOffice: (id: string) => boolean,
    private onChange: (id: string) => void,
  ) {}

  state(id: string): GitLabSignInsState {
    const s = this.load(id);
    const l = this.get(id);
    const how = this.how(id, s);
    return {
      how,
      hosts: gitlabHosts().map((host) => l.hosts[host] ? { host, ...l.hosts[host] } : s.seen?.[host] ? { host, status: 'ok', who: s.seen[host] } : { host, status: 'none' }),
      error: this.glab ? undefined : "The GitLab CLI (glab) isn't installed on the office's machine",
    };
  }

  /** Puts `id`'s own glab in place of the office's in `env` (in place), unless they use the office's. */
  apply(id: string, env: Record<string, string>): Record<string, string> {
    if (this.how(id, this.load(id)) === 'office') return env;
    for (const k of GITLAB_VARS) delete env[k];
    env.GLAB_CONFIG_DIR = this.dir(id);
    return env;
  }

  /** For the account's gitconfig: glab hands git their token when they push to a GitLab host. */
  credentialLines(id: string): string[] {
    if (!this.glab || this.how(id, this.load(id)) === 'office') return [];
    const helper = `!'${this.glab.replace(/'/g, `'\\''`)}' auth git-credential`;
    return gitlabHosts().flatMap((host) => [`[credential ${quote(`https://${host}`)}]`, '\thelper =', `\thelper = ${quote(helper)}`]);
  }

  /** A pasted personal access token for `host`. Resolves to why it didn't take. */
  async token(id: string, host: string, raw: string): Promise<string | undefined> {
    const token = raw.trim();
    if (!this.glab) return "The GitLab CLI (glab) isn't installed on the office's machine";
    if (!gitlabHosts().includes(host)) return `${host} isn't one of the office's GitLab hosts (⚙️ Settings)`;
    if (!GITLAB_TOKEN.test(token)) return "That doesn't look like a GitLab access token (glpat-…)";
    const s = this.load(id);
    delete s.use;
    this.save(id, s);
    const r = await run(this.glab, ['auth', 'login', '--hostname', host, '--stdin', '--git-protocol', 'https', '--insecure-storage'], this.env(id), `${token}\n`);
    await this.look(id, true);
    if (r.code !== 0) return `GitLab didn't take that token: ${r.last || 'glab auth login failed'}`;
    return this.get(id).hosts[host]?.status === 'ok' ? undefined : `GitLab didn't take that token: ${this.get(id).hosts[host]?.error ?? 'it can’t read your user'}`;
  }

  async signOut(id: string, host: string) {
    if (this.glab && gitlabHosts().includes(host)) await run(this.glab, ['auth', 'logout', '--hostname', host], this.env(id));
    await this.look(id, true);
  }

  /** Uses the office machine's own glab (admins only), or (`on` false) their own again. */
  useOffice(id: string, on: boolean): string | undefined {
    if (on && !this.mayUseOffice(id)) return "Only admins can use the office's own sign-ins";
    const s = this.load(id);
    if (on) s.use = 'office';
    else delete s.use;
    this.save(id, s);
    void this.look(id, true);
    return undefined;
  }

  /** Whether `id` acts on GitLab as someone: the office (their choice) or their own on `host`. */
  ready(id: string, host: string): boolean {
    const s = this.load(id);
    return this.how(id, s) === 'office' || !!s.seen?.[host];
  }

  /** Whether they use the office machine's own glab. */
  usesOffice(id: string): boolean {
    return this.how(id, this.load(id)) === 'office';
  }

  look(id: string, force = false): Promise<void> {
    const l = this.get(id);
    if (l.looking) return l.looking;
    if (!force && Date.now() - l.lookedAt < LOOK_GAP_MS) return Promise.resolve();
    l.looking = Promise.all(gitlabHosts().map((h) => this.lookHost(id, h))).then(() => {
      l.lookedAt = Date.now();
      l.looking = undefined;
      this.onChange(id);
    });
    return l.looking;
  }

  forget(id: string) {
    this.live.delete(id);
  }

  // ---------------------------------------------------------------------------

  private how(id: string, s: Saved): 'login' | 'office' {
    return s.use === 'office' && this.mayUseOffice(id) ? 'office' : 'login';
  }

  private get(id: string): Live {
    let l = this.live.get(id);
    if (!l) this.live.set(id, (l = { hosts: {}, lookedAt: 0 }));
    return l;
  }

  private dir(id: string): string {
    const d = path.join(this.homeOf(id), 'glab');
    if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 });
    return d;
  }

  /** glab as `id`'s own login (never the office's). */
  private env(id: string): Record<string, string> {
    const env = this.base();
    for (const k of GITLAB_VARS) delete env[k];
    env.GLAB_CONFIG_DIR = this.dir(id);
    return env;
  }

  private async lookHost(id: string, host: string) {
    const l = this.get(id);
    if (!this.glab) {
      l.hosts[host] = { status: 'none' };
      return;
    }
    const office = this.how(id, this.load(id)) === 'office';
    const r = await run(this.glab, ['api', '--hostname', host, 'user'], office ? this.base() : this.env(id));
    let user: { username?: string } = {};
    try {
      user = r.code === 0 ? JSON.parse(r.out) : {};
    } catch {
      // not JSON: treated as not signed in
    }
    const signedOut = /auth login|not logged in|authenticat|401|no token|unauthorized/i.test(r.last);
    l.hosts[host] = user.username ? { status: 'ok', who: `@${user.username}` } : { status: 'none', error: signedOut || !r.last ? undefined : r.last };
    const s = this.load(id);
    const who = office ? undefined : l.hosts[host].who;
    if ((s.seen?.[host] ?? undefined) === who) return;
    s.seen = { ...s.seen };
    if (who) s.seen[host] = who;
    else delete s.seen[host];
    this.save(id, s);
  }

  private load(id: string): Saved {
    try {
      const s = JSON.parse(readFileSync(path.join(this.homeOf(id), 'gitlab.json'), 'utf8')) as Saved;
      return s && typeof s === 'object' ? s : {};
    } catch {
      return {};
    }
  }

  private save(id: string, s: Saved) {
    try {
      writeFileSync(path.join(this.homeOf(id), 'gitlab.json'), JSON.stringify(s, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save ${id}'s GitLab sign-ins: ${(err as Error).message}`);
    }
  }
}
