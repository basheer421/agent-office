// Per-person GitLab sign-in (P5): a pasted token signs glab in inside the account's own folder, and
// whatever runs as the account gets that glab, never the office's GitLab token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitLabSignIns } from '../src/server/gitlab-signins.js';
import { DEFAULT_GITLAB_HOSTS, setGitlabHosts } from '../src/server/projects/detect.js';

const root = mkdtempSync(path.join(tmpdir(), 'gl-signins-'));
// A fake glab: `auth login --stdin` keeps the token in $GLAB_CONFIG_DIR, `api user` answers with it.
const glab = path.join(root, 'glab');
writeFileSync(
  glab,
  `#!/bin/sh
f="$GLAB_CONFIG_DIR/token"
case "$1 $2" in
  "auth login") cat > "$f"; exit 0;;
  "auth logout") rm -f "$f"; exit 0;;
  "api --hostname") if [ -s "$f" ] && grep -q glpat "$f"; then echo '{"username":"ada"}'; exit 0; else echo "401 Unauthorized" >&2; exit 1; fi;;
esac
exit 2
`,
);
chmodSync(glab, 0o755);

function make(admin = false) {
  const home = path.join(root, `acct${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(home);
  const base = () => ({ PATH: process.env.PATH ?? '', GITLAB_TOKEN: 'office-secret', GLAB_CONFIG_DIR: '/office/glab' });
  return { home, gl: new GitLabSignIns(() => home, glab, base, () => admin, () => {}) };
}

test('a pasted token signs that host in, and their env carries their glab, not the office token', async () => {
  setGitlabHosts(['gl.example']);
  try {
    const { home, gl } = make();
    assert.deepEqual(gl.state('a').hosts, [{ host: 'gl.example', status: 'none' }]);
    assert.equal(gl.ready('a', 'gl.example'), false);
    assert.match((await gl.token('a', 'gl.example', 'nope')) ?? '', /doesn't look like/);
    assert.match((await gl.token('a', 'other.example', 'glpat-aaaaaaaaaaaaaaaaaaaa')) ?? '', /isn't one of/);
    assert.equal(await gl.token('a', 'gl.example', 'glpat-aaaaaaaaaaaaaaaaaaaa'), undefined);
    assert.deepEqual(gl.state('a').hosts, [{ host: 'gl.example', status: 'ok', who: '@ada' }]);
    assert.equal(gl.ready('a', 'gl.example'), true);
    const env = gl.apply('a', { GITLAB_TOKEN: 'office-secret', OAUTH_TOKEN: 'x', HOME: '/h' });
    assert.deepEqual(env, { HOME: '/h', GLAB_CONFIG_DIR: path.join(home, 'glab') });
    assert.ok(gl.credentialLines('a').some((l) => l.includes('https://gl.example')));
    await gl.signOut('a', 'gl.example');
    assert.equal(gl.ready('a', 'gl.example'), false);
    assert.ok(!existsSync(path.join(home, 'glab', 'token')));
  } finally {
    setGitlabHosts(DEFAULT_GITLAB_HOSTS);
  }
});

test("only admins may use the office's own glab, which leaves the environment alone", () => {
  setGitlabHosts(['gl.example']);
  try {
    const member = make(false).gl;
    assert.match(member.useOffice('m', true) ?? '', /Only admins/);
    const admin = make(true).gl;
    assert.equal(admin.useOffice('a', true), undefined);
    assert.equal(admin.ready('a', 'gl.example'), true);
    assert.deepEqual(admin.apply('a', { GITLAB_TOKEN: 't' }), { GITLAB_TOKEN: 't' });
    assert.deepEqual(admin.credentialLines('a'), []);
  } finally {
    setGitlabHosts(DEFAULT_GITLAB_HOSTS);
  }
});
