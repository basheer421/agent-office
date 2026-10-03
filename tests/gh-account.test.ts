// The office picks which of gh's signed-in accounts acts on a repo, with a stub gh on PATH that
// is signed in to two: a work account (active) and the repo owner's personal one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hostFor, parseRemote, pickAccount } from '../src/server/hosts/index.js';
import { trackerFor } from '../src/server/trackers/index.js';
import { Boards } from '../src/server/boards.js';

const boards = (dir: string) => new Boards(hostFor(dir, 'github'), trackerFor(dir, 'github'), () => {}, () => {});

function office(remote: string, push: Record<string, boolean> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'gh-account-'));
  const bin = path.join(root, 'bin');
  const repo = path.join(root, 'repo');
  const log = path.join(root, 'gh.log');
  execFileSync('mkdir', ['-p', bin, repo]);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  const hosts = { hosts: { 'github.com': [
    { state: 'success', active: true, host: 'github.com', login: 'g137' },
    { state: 'success', active: false, host: 'github.com', login: 'basheer421' },
  ] } };
  writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
echo "GH_TOKEN=$GH_TOKEN $*" >> '${log}'
case "$*" in
  "auth status"*) echo '${JSON.stringify(hosts)}' ;;
  "auth token"*"--user g137") echo tok-g137 ;;
  "auth token"*"--user basheer421") echo tok-basheer421 ;;
  "api repos/"*) case "$GH_TOKEN" in ${Object.entries(push).map(([l, p]) => `tok-${l}) echo ${p} ;;`).join(' ')} *) echo false ;; esac ;;
  "pr merge"*) [ "$GH_TOKEN" = tok-basheer421 ] || { echo "GraphQL: g137 does not have the correct permissions to execute MergePullRequest" >&2; exit 1; } ;;
  "api user"*) t="\${GH_TOKEN:-tok-g137}"; echo "\${t#tok-}" ;;
  "repo view"*) echo '{"nameWithOwner":"o/r","squashMergeAllowed":true}' ;;
esac
`);
  chmodSync(path.join(bin, 'gh'), 0o755);
  return { repo, log, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: '', GITHUB_TOKEN: '' } };
}

function withPath<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  return fn().finally(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
}

test('remote URLs give the repo owner and name', () => {
  assert.deepEqual(parseRemote('git@github.com:basheer421/agent-office.git'), { host: 'github.com', owner: 'basheer421', name: 'agent-office' });
  assert.deepEqual(parseRemote('https://github.com/AgentSystemLabs/agent-office'), { host: 'github.com', owner: 'AgentSystemLabs', name: 'agent-office' });
});

test("the account named like the repo's owner is used, not gh's active one", async () => {
  const o = office('git@github.com:basheer421/agent-office.git');
  await withPath(o.env, async () => {
    const picked = await pickAccount(o.repo);
    assert.equal(picked?.login, 'basheer421');
    assert.equal(picked?.env.GH_TOKEN, 'tok-basheer421');

    const g = boards(o.repo);
    assert.equal(await g.merge(4, 'squash', false, false), undefined, 'the merge goes through as the owner');
    const merges = readFileSync(o.log, 'utf8').split('\n').filter((l) => l.includes('pr merge'));
    assert.deepEqual(merges.map((l) => l.split(' ')[0]), ['GH_TOKEN=tok-basheer421']);
    assert.ok(!readFileSync(o.log, 'utf8').includes('auth switch'), 'never switches the global account');
  });
});

test('on an org repo the account that can push is used, and none fitting leaves gh as it is', async () => {
  const pushes = office('https://github.com/some-org/app.git', { g137: false, basheer421: true });
  await withPath(pushes.env, async () => assert.equal((await pickAccount(pushes.repo))?.login, 'basheer421'));
  const neither = office('https://github.com/some-org/app.git');
  await withPath(neither.env, async () => {
    assert.equal(await pickAccount(neither.repo), undefined);
    const err = await boards(neither.repo).merge(4, 'squash', false, false);
    assert.match(err ?? '', /gh acted as @g137/, 'a denied merge names the account');
  });
});
