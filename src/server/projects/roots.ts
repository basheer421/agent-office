// The folders 📂 Open folder may look inside (default ~/code) and the hostnames that count as GitLab,
// kept in <office>/.agent-office/projects-roots.json; admins change them in ⚙️ Settings.
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectRootsState } from '../../shared/protocol/projects.js';
import { DEFAULT_GITLAB_HOSTS, setGitlabHosts } from './detect.js';

export const DEFAULT_ROOTS = ['~/code'];

export function untildify(p: string): string {
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

export function tildify(p: string): string {
  const home = os.homedir();
  return p === home ? '~' : p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export class ProjectRoots {
  private file: string;
  private state: ProjectRootsState = { roots: [...DEFAULT_ROOTS], gitlabHosts: [...DEFAULT_GITLAB_HOSTS], defaultHost: 'github' };

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'projects-roots.json');
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { roots?: unknown; gitlabHosts?: unknown; defaultHost?: unknown };
      const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : undefined);
      this.state.roots = strs(raw.roots) ?? this.state.roots;
      this.state.gitlabHosts = strs(raw.gitlabHosts) ?? this.state.gitlabHosts;
      if (raw.defaultHost === 'gitlab') this.state.defaultHost = 'gitlab';
    } catch {
      // never set: the defaults
    }
    setGitlabHosts(this.state.gitlabHosts);
  }

  get roots(): string[] {
    return this.state.roots;
  }

  get gitlabHosts(): string[] {
    return this.state.gitlabHosts;
  }

  view(): ProjectRootsState {
    return { ...this.state };
  }

  /** Replaces either list. Returns why it can't. */
  set(next: Partial<ProjectRootsState>): string | undefined {
    const roots = next.roots?.map((r) => r.trim()).filter(Boolean);
    if (roots) {
      if (!roots.length) return 'Keep at least one folder to open projects from';
      for (const r of roots) if (!path.isAbsolute(untildify(r))) return `Use a full path, like ~/code (not ${r})`;
    }
    const hosts = next.gitlabHosts?.map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (hosts?.some((x) => !/^[a-z0-9.-]+(:\d+)?$/.test(x))) return 'GitLab hosts are hostnames, like gitlab.example.com';
    if (hosts && !hosts.length) return 'Keep at least one GitLab host (the default is gitlab.g137.io)';
    const defaultHost = next.defaultHost === 'gitlab' || next.defaultHost === 'github' ? next.defaultHost : this.state.defaultHost;
    this.state = { roots: roots ?? this.state.roots, gitlabHosts: hosts ?? this.state.gitlabHosts, defaultHost };
    setGitlabHosts(this.state.gitlabHosts);
    try {
      writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    } catch (err) {
      return `Couldn't save ${this.file}: ${(err as Error).message}`;
    }
    return undefined;
  }

  /**
   * `raw` as a real folder inside one of the roots ('~' is the home folder), symlinks resolved, so
   * `..` or a link can't step out of them. Returns the path, or why not.
   */
  resolveInside(raw: string): { dir: string } | { error: string } {
    const typed = untildify(raw.trim());
    if (!typed || !path.isAbsolute(typed)) return { error: 'Use a full path, like ~/code/project' };
    let real: string;
    try {
      real = realpathSync(typed);
    } catch {
      return { error: `${tildify(typed)} doesn't exist` };
    }
    const roots = this.state.roots.map((r) => {
      try {
        return realpathSync(untildify(r));
      } catch {
        return path.resolve(untildify(r));
      }
    });
    if (!roots.some((r) => inside(real, r))) return { error: `${tildify(real)} isn't inside ${this.state.roots.join(', ')} — an admin can add folders in ⚙️ Settings` };
    try {
      if (!statSync(real).isDirectory()) return { error: `${tildify(real)} isn't a folder` };
    } catch (err) {
      return { error: (err as Error).message };
    }
    return { dir: real };
  }
}
