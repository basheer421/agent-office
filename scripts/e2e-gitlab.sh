#!/usr/bin/env bash
# End-to-end check of the GitLab code host against a real, throwaway GitLab project:
# clone it, push a branch, open an MR through GitLabHost, see it on the list, merge it, see `merged`.
# Usage: scripts/e2e-gitlab.sh <host> <group/project>   (a SCRATCH project: it creates and merges an MR)
set -euo pipefail
host=${1:?host, e.g. gitlab.g137.io}
project=${2:?group/project of a scratch project}
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d /tmp/ao-e2e-gitlab.XXXXXX)
branch="office/e2e-$(date +%s)"
enc() { node -e 'console.log(encodeURIComponent(process.argv[1]))' "$1"; }
cleanup() {
  glab api --hostname "$host" -X DELETE "projects/$(enc "$project")/repository/branches/$(enc "$branch")" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

git clone -q "git@$host:$project.git" "$work/repo"
cd "$work/repo"
git checkout -q -b "$branch"
echo "e2e $(date -u +%FT%TZ)" > ao-e2e.txt
git add ao-e2e.txt && git commit -qm "e2e: agent-office GitLab host"
git push -q origin "$branch"

cat > "$work/run.mts" <<EOF
import { setGitlabHosts } from '$here/src/server/projects/detect.ts';
import { hostFor } from '$here/src/server/hosts/index.ts';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
setGitlabHosts(['$host']);
const h = hostFor('$work/repo');
if (h.kind !== 'gitlab') throw new Error('expected the GitLab host, got ' + h.kind);
const mr = await h.create({ source: '$branch', title: 'e2e: agent-office GitLab host', body: 'Opened and merged by scripts/e2e-gitlab.sh' });
console.log('opened', mr.url);
if (!(await h.list()).some((c) => c.number === mr.number && c.state === 'open')) throw new Error('new MR not on the list');
if ((await h.findForBranch('$branch'))?.number !== mr.number) throw new Error('findForBranch missed it');
await h.comment(mr.number, 'e2e comment');
// GitLab may still be working out whether it can merge.
for (let i = 0; ; i++) {
  try { await h.merge(mr.number, { method: 'squash', deleteBranch: true }); break; } catch (e) { if (i > 10) throw e; await sleep(3000); }
}
for (let i = 0; i < 10; i++, await sleep(2000)) {
  if ((await h.get(mr.number)).state === 'merged') { console.log('merged', mr.url); process.exit(0); }
}
throw new Error('MR never showed as merged');
EOF
(cd "$here" && node --import tsx "$work/run.mts")
echo "e2e-gitlab: OK"
