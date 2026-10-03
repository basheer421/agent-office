// The GitHub adapter's pure parts (gh JSON → model, spotting `gh pr create`), how a folder's host
// is picked, and the boards with a host whose label change doesn't say the labels it left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changeRequest, checkOf, checksOf, crState } from '../src/server/hosts/github/map.js';
import { GitHubHost, ownPr } from '../src/server/hosts/github/index.js';
import type { GitHubRepo } from '../src/server/hosts/github/repo.js';
import { hostKindOf } from '../src/server/hosts/index.js';
import { NoHost } from '../src/server/hosts/none.js';
import { NoTracker } from '../src/server/trackers/none.js';
import { Boards } from '../src/server/boards.js';
import type { CodeHost } from '../src/server/hosts/index.js';
import type { ChangeRequest } from '../src/shared/model/change-request.js';

test('crState: drafts are open ones, merged and closed win over isDraft', () => {
  assert.equal(crState('OPEN', false), 'open');
  assert.equal(crState('OPEN', true), 'draft');
  assert.equal(crState('MERGED', true), 'merged');
  assert.equal(crState('CLOSED', true), 'closed');
});

test('the card (checksOf) and the detail (checkOf) agree on every conclusion', () => {
  const conclusions = ['SUCCESS', 'FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'SKIPPED', 'NEUTRAL', 'STALE', 'PENDING', 'EXPECTED'];
  for (const conclusion of conclusions) {
    const c = { name: 'ci', status: 'COMPLETED', conclusion };
    const one = checkOf(c).state;
    const card = checksOf([c]);
    if (one === 'fail') assert.equal(card, 'fail', conclusion);
    else if (one === 'pending') assert.equal(card, 'pending', conclusion);
    else assert.equal(card, 'pass', conclusion);
  }
  assert.equal(checksOf([]), 'none');
  assert.equal(checksOf([{ status: 'IN_PROGRESS' }]), 'pending');
});

test('changeRequest keeps real closing issue numbers only and trims a long body', () => {
  const cr = changeRequest({
    number: 3, title: 't', state: 'OPEN', isDraft: false, url: 'u', author: { login: 'a' }, labels: [{ name: 'bug', color: 'ff0000' }],
    headRefName: 'b', headRefOid: 'abc', baseRefName: 'main', body: 'x'.repeat(5000),
    closingIssuesReferences: [{ number: 4 }, { number: 0 }, { number: 'nope' }, { number: 7 }],
  });
  assert.deepEqual(cr.closes, ['4', '7']);
  assert.equal(cr.body.length, 4000);
  assert.deepEqual(cr.labels, [{ name: 'bug', color: '#ff0000' }]);
  assert.equal(cr.sourceSha, 'abc');
});

test('ownPr: only a real gh pr create, and the last URL it printed', () => {
  const out = 'https://github.com/o/r/pull/1\nWarning\nhttps://github.com/o/r/pull/2\n';
  assert.deepEqual(ownPr('gh pr create --fill', out), { repo: 'o/r', number: 2, url: 'https://github.com/o/r/pull/2' });
  assert.ok(ownPr('git push && gh pr create -t x', out));
  assert.equal(ownPr('grep "gh pr create" notes', out), undefined);
  assert.equal(ownPr('echo foo', out), undefined);
  assert.equal(ownPr('gh pr create', 'no url here'), undefined);
  assert.equal(ownPr(undefined, out), undefined);
});

function repoWith(...remotes: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-kind-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  remotes.forEach((url, i) => execFileSync('git', ['remote', 'add', `r${i}`, url], { cwd: dir }));
  return dir;
}

test('hostKindOf: GitHub, GitLab, no remote, and both', () => {
  assert.equal(hostKindOf(repoWith('git@github.com:o/r.git')), 'github');
  assert.equal(hostKindOf(repoWith('git@gitlab.g137.io:g/p.git')), 'none');
  assert.equal(hostKindOf(repoWith()), 'github');
  assert.equal(hostKindOf(repoWith('git@gitlab.com:g/p.git', 'https://github.com/o/r')), 'github');
});

test('a host with no known boards says why instead of showing nothing', async () => {
  await assert.rejects(new NoHost('not yet').list(), /not yet/);
  await assert.rejects(new NoTracker('not yet').list(), /not yet/);
  assert.deepEqual(await new NoHost().list(), []);
});

test('boards: a label change the host does but doesn\'t answer with reads the labels off a fresh list', async () => {
  let labels = [{ name: 'old', color: '#000000' }];
  const cr: ChangeRequest = {
    number: 5, title: 't', state: 'open', url: '', author: '', labels, reviewDecision: '', sourceBranch: 'b', targetBranch: 'main',
    createdAt: '', updatedAt: '', additions: 0, deletions: 0, checks: 'none', body: '', closes: [],
  };
  const host = Object.assign(new NoHost(), {
    list: async () => [{ ...cr, labels }],
    labels: {
      list: async () => [],
      set: async (_n: number, add: string[]) => {
        labels = add.map((name) => ({ name, color: '#111111' }));
      },
    },
  }) as unknown as CodeHost;
  const boards = new Boards(host, new NoTracker(), () => {}, () => {});
  const r = await boards.setLabels('pull', 5, ['new'], ['old']);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.labels, [{ name: 'new', color: '#111111' }]);
});

test('create: the PR number off the URL gh printed, or an error when it printed none', async () => {
  const hostPrinting = (out: string) => new GitHubHost({ gh: async () => out } as unknown as GitHubRepo);
  const pr = await hostPrinting('Creating pull request\nhttps://github.com/o/r/pull/42\n').create({ source: 'b', target: 'main', title: 't', body: 'x' });
  assert.equal(pr.number, 42);
  assert.equal(pr.url, 'https://github.com/o/r/pull/42');
  assert.equal(pr.state, 'open');
  await assert.rejects(hostPrinting('something went sideways').create({ source: 'b', title: 't', body: '' }), /did not return a pull request URL/);
});
