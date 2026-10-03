import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detect, parseRemoteUrl } from '../src/server/projects/detect.js';
import { ProjectRoots } from '../src/server/projects/roots.js';
import { effective, overrides, setOverrides } from '../src/server/projects/store.js';
import { Worktrees } from '../src/server/worktrees.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
function repo(remotes: Record<string, string> = {}): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ao-proj-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'first');
  for (const [name, url] of Object.entries(remotes)) git(dir, 'remote', 'add', name, url);
  return dir;
}

test('remote URLs taken apart', () => {
  assert.deepEqual(parseRemoteUrl('git@gitlab.g137.io:developers/brain.git'), { hostname: 'gitlab.g137.io', projectPath: 'developers/brain' });
  assert.deepEqual(parseRemoteUrl('https://gitlab.g137.io/group/sub/app.git'), { hostname: 'gitlab.g137.io', projectPath: 'group/sub/app' });
  assert.deepEqual(parseRemoteUrl('ssh://git@github.com/o/r.git'), { hostname: 'github.com', projectPath: 'o/r' });
});

test('detects GitLab ssh, https, GitHub and no remote', () => {
  const ssh = repo({ origin: 'git@gitlab.g137.io:developers/brain.git' });
  const https = repo({ upstream: 'https://gitlab.g137.io/developers/brain.git' });
  const gh = repo({ origin: 'git@github.com:basheer421/agent-office.git', other: 'git@example.com:x/y.git' });
  const none = repo();
  const plain = realpathSync(mkdtempSync(path.join(tmpdir(), 'ao-plain-')));
  try {
    git(ssh, 'update-ref', 'refs/remotes/origin/dev', 'HEAD');
    git(ssh, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev');
    assert.deepEqual(detect(ssh), { isGit: true, remotes: ['origin'], pushRemote: 'origin', url: 'git@gitlab.g137.io:developers/brain.git', host: 'gitlab', hostname: 'gitlab.g137.io', projectPath: 'developers/brain', baseBranch: 'dev' });
    const h = detect(https);
    assert.equal(h.pushRemote, 'upstream');
    assert.equal(h.host, 'gitlab');
    assert.equal(detect(https, ['other.host']).host, 'none');
    assert.equal(detect(gh).host, 'github');
    assert.equal(detect(gh).projectPath, 'basheer421/agent-office');
    assert.deepEqual(detect(none), { isGit: true, remotes: [], pushRemote: undefined, host: 'none' });
    assert.equal(detect(plain).isGit, false);
  } finally {
    for (const d of [ssh, https, gh, none, plain]) rmSync(d, { recursive: true, force: true });
  }
});

test('overrides round-trip, and worktrees follow them', () => {
  const dir = repo({ origin: 'git@github.com:o/r.git', fork: 'git@gitlab.g137.io:me/r.git' });
  try {
    assert.equal(effective(dir).pushRemote, 'origin');
    assert.match(setOverrides(dir, { pushRemote: 'nope' }) ?? '', /no remote called nope/);
    assert.match(setOverrides(dir, { baseBranch: '--evil' }) ?? '', /isn't a name/);
    assert.equal(setOverrides(dir, { pushRemote: 'fork', baseBranch: 'dev' }), undefined);
    assert.deepEqual(overrides(dir), { pushRemote: 'fork', baseBranch: 'dev' });
    const cfg = effective(dir);
    assert.equal(cfg.pushRemote, 'fork');
    assert.equal(cfg.host, 'gitlab');
    assert.equal(cfg.baseBranch, 'dev');
    assert.equal(cfg.detected.pushRemote, 'origin');
    assert.deepEqual(cfg.overridden.sort(), ['baseBranch', 'pushRemote']);
    const trees = new Worktrees(dir);
    assert.equal(trees.remote(), 'fork');
    assert.equal(trees.baseBranch(), 'dev');
    // A worktree reads its project's settings.
    git(dir, 'worktree', 'add', '-q', '-b', 'w', path.join(dir, 'wt'));
    assert.equal(effective(path.join(dir, 'wt')).pushRemote, 'fork');
    assert.equal(setOverrides(dir, {}), undefined);
    assert.equal(effective(dir).pushRemote, 'origin');
    assert.equal(new Worktrees(dir).baseBranch(), 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveInside keeps to the roots', () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ao-roots-')));
  const root = path.join(base, 'code');
  const outside = path.join(base, 'secret');
  mkdirSync(path.join(root, 'app'), { recursive: true });
  mkdirSync(outside);
  symlinkSync(outside, path.join(root, 'link'));
  try {
    const roots = new ProjectRoots(base);
    assert.equal(roots.set({ roots: [root] }), undefined);
    assert.deepEqual(roots.resolveInside(path.join(root, 'app')), { dir: path.join(root, 'app') });
    assert.ok('error' in roots.resolveInside(path.join(root, '..', 'secret')));
    assert.ok('error' in roots.resolveInside(path.join(root, 'link')));
    assert.ok('error' in roots.resolveInside(path.join(root, 'missing')));
    assert.ok('error' in roots.resolveInside('relative/path'));
    assert.deepEqual(new ProjectRoots(base).roots, [root]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
