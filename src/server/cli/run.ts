// The one place the office runs a code host's CLI (gh, glab). Adapters build the arguments;
// this runs them and turns failures into HostErrors a person at the board can act on.
import { execFile } from 'node:child_process';
import { HostError, type HostErrorKind } from '../../shared/model/host.js';

export interface CliOptions {
  cwd: string;
  /** Replaces the environment (a person's own sign-in, see signins.ts); the office's when unset. */
  env?: Record<string, string>;
  timeout?: number;
  input?: string;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `bin args`. Resolves with any exit code; rejects only when the binary can't run at all. */
export function runCli(bin: string, args: string[], o: CliOptions): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { cwd: o.cwd, env: o.env, timeout: o.timeout ?? 30_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new HostError('cli-missing', `${bin} is not installed on the server`));
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr || (err && code !== 0 && !stderr ? err.message : '')) });
    });
    if (o.input !== undefined) child.stdin?.end(o.input);
  });
}

/** The last two lines of stderr: where gh and glab put the reason. */
export function lastLines(raw: string): string {
  return raw.trim().split('\n').slice(-2).join(' ');
}

/** What kind of failure a CLI's stderr describes. */
export function errorKind(raw: string): HostErrorKind {
  if (/no git remotes found|none of the git remotes|no remote/i.test(raw)) return 'no-remote';
  if (/auth login|not logged in|authentication|\b401\b/i.test(raw)) return 'auth';
  if (/rate limit|\b429\b/i.test(raw)) return 'rate-limit';
  if (/could not resolve to a repository|not found|\b404\b/i.test(raw)) return 'not-found';
  return 'failed';
}

/** Runs the CLI and resolves with stdout, or rejects with a HostError built from stderr. */
export async function cliText(bin: string, args: string[], o: CliOptions): Promise<string> {
  const r = await runCli(bin, args, o);
  if (r.code === 0) return r.stdout;
  const msg = lastLines(r.stderr);
  throw new HostError(errorKind(msg), msg);
}

/** cliText, parsed as JSON. */
export async function cliJson<T>(bin: string, args: string[], o: CliOptions): Promise<T> {
  return JSON.parse(await cliText(bin, args, o)) as T;
}
