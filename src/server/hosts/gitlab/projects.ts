// The office's GitLab account: the projects its glab sign-in is a member of (for ⬇️ Clone), and
// cloning one with plain git over ssh.
import { spawn } from 'node:child_process';
import { cliJson } from '../../cli/run.js';
import { apiArgs } from './index.js';

export interface GitLabProject {
  path: string;
  description?: string;
  activityAt?: string;
  sshUrl: string;
}

interface GlProject {
  path_with_namespace: string;
  description?: string | null;
  last_activity_at?: string;
  ssh_url_to_repo: string;
}

/** Up to 100 of the projects `host`'s glab sign-in belongs to, most recently active first. */
export async function gitlabProjects(host: string, cwd: string): Promise<GitLabProject[]> {
  const ps = await cliJson<GlProject[]>('glab', apiArgs(host, 'GET', 'projects?membership=true&simple=true&order_by=last_activity_at&per_page=100'), { cwd });
  return ps.map((p) => ({ path: p.path_with_namespace, description: p.description || undefined, activityAt: p.last_activity_at, sshUrl: p.ssh_url_to_repo }));
}

/** One project, by path: whether this sign-in can see it, and its ssh URL. */
export async function gitlabProject(host: string, projectPath: string, cwd: string): Promise<GitLabProject> {
  const p = await cliJson<GlProject>('glab', apiArgs(host, 'GET', `projects/${encodeURIComponent(projectPath)}`), { cwd });
  return { path: p.path_with_namespace, description: p.description || undefined, activityAt: p.last_activity_at, sshUrl: p.ssh_url_to_repo };
}

/** `git clone <sshUrl> <dest>`, no prompts (nobody would see them). Resolves to why it failed, if it did. */
export function cloneGitlab(sshUrl: string, dest: string, timeoutMs = 10 * 60_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    let err = '';
    const child = spawn('git', ['clone', '--', sshUrl, dest], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' }, stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs });
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    child.once('error', (e) => resolve(`Couldn't run git: ${e.message}`));
    child.once('exit', (code) => resolve(code === 0 ? undefined : `git clone failed: ${err.trim().split('\n').pop() ?? `exit ${code}`}`));
  });
}
