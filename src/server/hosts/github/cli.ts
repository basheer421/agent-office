// Running gh for the GitHub adapter: its failures turned into something a person can act on.
import { HostError } from '../../../shared/model/host.js';
import { lastLines, runCli } from '../../cli/run.js';

/** Turns gh's stderr into something a person standing at the board can act on. */
function friendly(raw: string): string {
  if (/no git remotes found|none of the git remotes/i.test(raw)) return 'This project has no GitHub remote yet. Push it to GitHub (git remote add origin <url>) to fill the boards.';
  if (/not a git repository/i.test(raw)) return "This folder isn't a git repository";
  if (/auth login|not logged in|authentication/i.test(raw)) return "gh isn't signed in to GitHub on the office's machine — run `gh auth login` there";
  if (/could not resolve to a repository|not found/i.test(raw)) return "gh can't find this repository on GitHub (check the remote and access)";
  return raw;
}

/** Runs gh as the office, or with `env` as someone signed in to their own GitHub (see signins.ts). */
export async function gh(args: string[], cwd: string, timeout = 30_000, env?: Record<string, string>, own = env !== undefined, input?: string): Promise<string> {
  let r;
  try {
    r = await runCli('gh', args, { cwd, timeout, env, input });
  } catch (e) {
    if (e instanceof HostError && e.kind === 'cli-missing') throw new Error('GitHub CLI (gh) is not installed on the server');
    throw e;
  }
  if (r.code === 0) return r.stdout;
  const msg = lastLines(r.stderr);
  const signedOut = own && /auth login|not logged in|authentication/i.test(msg);
  throw new Error(signedOut ? 'Your GitHub sign-in stopped working — sign in again (☰ → 🔐 Your sign-ins)' : friendly(msg));
}

/** gh's JSON output, or an error a person can read when it isn't JSON. */
export function json(out: string): any {
  try {
    return JSON.parse(out);
  } catch {
    throw new Error("gh answered with something that isn't JSON (try again, or check gh on the office's machine)");
  }
}

/** gh --jq output that prints one JSON object per line. */
export function jsonLines(out: string): any[] {
  return out.split('\n').flatMap((l) => (l.trim() ? [json(l)] : []));
}
