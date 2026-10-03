// Contract test for the GitLab code host against a fake glab (tests/fixtures/bin/glab):
// every call it makes must be a recorded one, and the answers must map to the neutral model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitLabHost, glabCreatedBy } from '../src/server/hosts/gitlab/index.js';
import { DEFAULT_GITLAB_HOSTS } from '../src/server/projects/detect.js';
import { glabPrompt } from '../src/shared/glab-prompt.js';
import { PROMPTS, PROMPT_IDS, fillPrompt } from '../src/shared/prompts.js';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const log = path.join(mkdtempSync(path.join(tmpdir(), 'fake-glab-')), 'calls.jsonl');
process.env.PATH = `${path.join(fixtures, 'bin')}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_GLAB_FIXTURES = path.join(fixtures, 'glab', 'basic.json');
process.env.FAKE_GLAB_LOG = log;

const host = new GitLabHost({ host: 'gl.example', projectPath: 'grp/app', cwd: tmpdir() });
const calls = (): string[][] => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('lists open, merged and closed MRs in neutral words', async () => {
  const crs = await host.list();
  assert.deepEqual(crs.map((c) => [c.number, c.state, c.checks]), [[7, 'open', 'pending'], [8, 'draft', 'none'], [5, 'merged', 'pass']]);
  assert.deepEqual(crs[0].labels, [{ name: 'bug', color: '#d73a4a', description: 'Broken' }, { name: 'extra', color: '#6699cc' }]);
  assert.deepEqual(crs[0].closes, ['3', '4']);
  assert.equal(crs[0].sourceBranch, 'office/a');
  assert.equal(crs[1].body, '');
});

test('detail: notes, line comments, pipeline as checks, approvals missing is not an error', async () => {
  const d = await host.detail(7);
  assert.equal(d.mergeable, 'MERGEABLE');
  assert.equal(d.commits, 2);
  assert.equal(d.viewer, 'bachir');
  assert.equal(d.reviewDecision, '');
  assert.deepEqual(d.comments.map((c) => c.body), ['looks good']);
  assert.deepEqual(d.checks, [{ name: 'pipeline #99', state: 'fail', url: 'https://gl.example/p/99' }]);
  assert.deepEqual(d.reviewComments.map((c) => [c.id, c.replyTo, c.path, c.line, c.side]), [[10, undefined, 'a.ts', 4, 'RIGHT'], [11, 10, 'a.ts', 2, 'LEFT']]);
});

test('diff is rebuilt as a unified diff', async () => {
  assert.equal(await host.diff(7), [
    'diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,2 +1,2 @@', '-old', '+new', ' ctx',
    'diff --git a/b.ts b/b.ts', 'new file mode 100644', '--- /dev/null', '+++ b/b.ts', '@@ -0,0 +1 @@', '+hi', '',
  ].join('\n'));
});

test('create, merge when the pipeline succeeds, close with a comment, labels', async () => {
  const cr = await host.create({ source: 'office/a', target: 'dev', title: 'T', body: 'B' });
  assert.equal(cr.number, 9);
  await host.merge(7, { method: 'squash', auto: true, deleteBranch: true });
  await host.close(7, { comment: 'bye' });
  await host.labels.set(7, ['bug'], []);
  assert.equal(await host.findForBranch('office/a'), undefined);
  const mutating = calls().filter((c) => c.includes('-X')).map((c) => c.slice(3).join(' '));
  assert.ok(mutating.includes('projects/grp%2Fapp/merge_requests/7 -X PUT -f state_event=close'));
  await assert.rejects(host.merge(7, { method: 'rebase' }), /rebase/);
});

test('an unrecorded call fails with the host error, not silently', async () => {
  await assert.rejects(host.detail(404), (e: Error) => e.name === 'HostError');
});

test('recognises a worker opening its own MR', () => {
  const out = 'Creating merge request for office/a into dev\n!12 Add thing\nhttps://gitlab.g137.io/developers/brain/-/merge_requests/12\n';
  assert.equal(glabCreatedBy('glab mr create --fill --target-branch dev', out), 'https://gitlab.g137.io/developers/brain/-/merge_requests/12');
  assert.equal(glabCreatedBy('git push', out), undefined);
});

test('words are GitLab\'s', () => {
  assert.deepEqual(host.words, { crNoun: 'merge request', crShort: 'MR', refPrefix: '!', cli: 'glab' });
  assert.deepEqual(host.caps.mergeMethods, ['merge', 'squash']);
});

test('a floor on a GitLab remote gets the GitLab host, with ⚙️\'s hosts', async () => {
  const { hostFor } = await import('../src/server/hosts/index.js');
  const { setGitlabHosts } = await import('../src/server/projects/detect.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-gl-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', 'git@gl.example:grp/sub/app.git'], { cwd: dir });
  assert.equal(hostFor(dir).kind, 'github');
  setGitlabHosts(['gl.example']);
  try {
    assert.equal(hostFor(dir).kind, 'gitlab');
  } finally {
    setGitlabHosts(DEFAULT_GITLAB_HOSTS);
  }
});

test('every default prompt reads as GitLab with glab, no gh left', () => {
  for (const id of PROMPT_IDS) {
    const text = glabPrompt(fillPrompt(PROMPTS[id].text, { number: '12', repo: 'grp/app', branch: 'office/a', base: 'dev', title: 't', url: 'u', pr: '12' }));
    assert.doesNotMatch(text, /\bgh (pr|api)\b|pull request|\bPR #/, id);
  }
  assert.equal(glabPrompt('Read it with `gh pr view 12 --comments` and `gh pr diff 12`.'), 'Read it with `glab mr view 12 --comments` and `glab mr diff 12`.');
});
