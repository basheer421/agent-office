// The architecture guard: code hosts and trackers are reached only through their ports.
// (1) No one spawns gh or glab except the CLI runner and the adapters.
// (2) No one imports an adapter except the factory in hosts/index.ts (trackers/index.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('.ts') && existsSync(path.join(root, f)));

const ADAPTER_DIRS = /^src\/server\/(cli\/|hosts\/[^/]+\/|trackers\/[^/]+\/)/;

/** Files that still spawn gh themselves. P1b removes them, until only the path resolve is left. */
const SPAWN_ALLOWED = new Set([
  'src/server/github.ts', // P1b removes: becomes hosts/github + trackers/github
  'src/server/clone.ts', // P1b removes: hosts/github/account.ts
  'src/server/setup.ts', // P1b removes: hosts/github/account.ts
  'src/server/building.ts', // P1b removes: hosts/github/account.ts
]);

const SPAWN = /\b(execFile|execFileSync|spawn|spawnSync|runCli|cliText|cliJson)\(\s*['"](gh|glab)['"]/;

test('only the CLI runner and the adapters spawn gh or glab', () => {
  const bad = files.filter((f) => !ADAPTER_DIRS.test(f) && !SPAWN_ALLOWED.has(f) && SPAWN.test(readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(bad, [], `These spawn gh/glab directly; go through a CodeHost or IssueTracker instead (tests/architecture.test.ts):\n${bad.join('\n')}`);
});

test('the spawn allow-list only lists files that still need it', () => {
  const stale = [...SPAWN_ALLOWED].filter((f) => !existsSync(path.join(root, f)) || !SPAWN.test(readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(stale, [], `Take these off SPAWN_ALLOWED in tests/architecture.test.ts:\n${stale.join('\n')}`);
});

const ADAPTER_IMPORT = /from\s+['"][^'"]*\/(hosts|trackers)\/(github|gitlab|clickup)(\/[^'"]*)?(\.js)?['"]/;

test('only the factories import an adapter', () => {
  const bad = files.filter((f) => {
    if (f === 'src/server/hosts/index.ts' || f === 'src/server/trackers/index.ts') return false;
    // An adapter's own files import each other.
    if (/^src\/server\/(hosts|trackers)\/(github|gitlab|clickup)\//.test(f)) return false;
    return ADAPTER_IMPORT.test(readFileSync(path.join(root, f), 'utf8'));
  });
  assert.deepEqual(bad, [], `These import an adapter directly; use hostFor()/trackerFor() (tests/architecture.test.ts):\n${bad.join('\n')}`);
});
