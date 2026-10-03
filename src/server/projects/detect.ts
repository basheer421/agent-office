// What a folder on the office's machine is, as far as the office cares: a git checkout or not, which
// remote it pushes to, where that remote lives (GitHub, GitLab, neither) and its default branch.
// Detected every time it's asked, so a changed remote is picked up by itself (see store.ts).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { HostKind } from '../../shared/model/host.js';

/** GitLab hostnames the office knows, unless ⚙️ says otherwise. */
export const DEFAULT_GITLAB_HOSTS = ['gitlab.g137.io'];

export interface Detected {
  isGit: boolean;
  remotes: string[];
  /** `origin`, else the only remote. */
  pushRemote?: string;
  /** That remote's URL. */
  url?: string;
  host: HostKind;
  hostname?: string;
  /** owner/name on GitHub, group/…/name on GitLab. */
  projectPath?: string;
  /** refs/remotes/<pushRemote>/HEAD: the host's default branch. */
  baseBranch?: string;
}

function git(dir: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

/** A remote's URL taken apart: ssh (`git@host:path`, `ssh://…`) or http(s). */
export function parseRemoteUrl(url: string): { hostname: string; projectPath: string } | undefined {
  const text = url.trim();
  let hostname: string | undefined;
  let rest: string | undefined;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(text);
  if (/^[a-z+]+:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      hostname = u.hostname;
      rest = u.pathname;
    } catch {
      return undefined;
    }
  } else if (scp) {
    hostname = scp[1];
    rest = scp[2];
  }
  if (!hostname || !rest) return undefined;
  const projectPath = rest.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!projectPath.includes('/')) return undefined;
  return { hostname: hostname.toLowerCase(), projectPath };
}

export function hostKindOf(hostname: string | undefined, gitlabHosts: readonly string[]): HostKind {
  if (!hostname) return 'none';
  if (hostname === 'github.com' || hostname === 'www.github.com') return 'github';
  if (gitlabHosts.some((h) => h.toLowerCase() === hostname)) return 'gitlab';
  return 'none';
}

export function detect(dir: string, gitlabHosts: readonly string[] = DEFAULT_GITLAB_HOSTS): Detected {
  const isGit = existsSync(path.join(dir, '.git')) || git(dir, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!isGit) return { isGit: false, remotes: [], host: 'none' };
  const remotes = (git(dir, ['remote']) ?? '').split('\n').filter(Boolean);
  const pushRemote = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : undefined;
  const out: Detected = { isGit, remotes, pushRemote, host: 'none' };
  if (!pushRemote) return out;
  return { ...out, ...remoteFacts(dir, pushRemote, gitlabHosts) };
}

/** What follows from the remote pushed to: its URL, host and default branch. */
export function remoteFacts(dir: string, remote: string, gitlabHosts: readonly string[]): Pick<Detected, 'url' | 'host' | 'hostname' | 'projectPath' | 'baseBranch'> {
  const url = git(dir, ['remote', 'get-url', remote]);
  const parsed = url ? parseRemoteUrl(url) : undefined;
  const head = git(dir, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]);
  const baseBranch = head?.startsWith(`refs/remotes/${remote}/`) ? head.slice(`refs/remotes/${remote}/`.length) : undefined;
  return { url, host: hostKindOf(parsed?.hostname, gitlabHosts), hostname: parsed?.hostname, projectPath: parsed?.projectPath, baseBranch };
}
