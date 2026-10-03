# Execution brief: fork plan (read this first, every session)

You are executing `docs/plans/fork-architecture.md` (the WHY and the design). This file is the HOW: exact state, steps, guardrails, checks. Follow it literally. When something here is wrong, fix this file in the same PR.

## 1. Where things are

| Thing | Value |
|---|---|
| Main checkout (shared, don't work in it) | `~/code/private/agent-office` |
| Plan worktree / branch | `~/code/private/agent-office-wt/plan` on `plan/fork-architecture` (not pushed yet) |
| Remotes | `origin` = `git@github.com:basheer421/agent-office.git` (the fork). `upstream` = AgentSystemLabs, **push disabled** |
| Commit identity | repo-local: `basheer421 <basheer123b2@gmail.com>` (already set; worktrees inherit it, check with `git config user.email`) |
| `gh` for the fork | `GH_TOKEN=$(gh auth token -u basheer421) gh …` on every call. **Never** `gh auth switch` (global, breaks other sessions on `bammar-g137`) |
| Test project | `/tmp/ao-test/brain`: `--local` clone of Brain, origin set to `git@gitlab.g137.io:developers/brain.git`, on `dev`. Never use `~/code/g137/brain` itself for tests |
| Test office | `cd <worktree> && AGENT_OFFICE_HOME=/tmp/ao-test/home AGENT_OFFICE_PROJECTS=/tmp/ao-test/projects node bin/agent-office.js /tmp/ao-test/brain --port 4700 --password aotest --agent pi --no-open` (run with `bg_run`, never blocking). One may already be running from the main checkout: check `lsof -iTCP:4700 -sTCP:LISTEN`, kill it before starting yours |
| Driving it without a browser | `/tmp/ao-test/ws.mjs` (login + WebSocket; `node ws.mjs spawn "<prompt>"`, `node ws.mjs pr <workerId>`). The WS URL must use `localhost`, not `127.0.0.1` (origin check → 401) |
| Screenshots | playwright-core from `node_modules` + `~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`. `/lite` works; clicking **New task** crashed headless shell — drive through `ws.mjs` instead. Example: `/tmp/ao-test/shot.mjs` |

## 2. Rules (non-negotiable)

1. **One phase = one branch = one PR on the fork.** Branch from fresh `origin/main` in a new worktree: `git -C ~/code/private/agent-office fetch origin && git -C ~/code/private/agent-office worktree add -b <branch> ../agent-office-wt/<branch> origin/main`, then `npm install` in it.
2. Open PRs **against the fork**: `GH_TOKEN=$(gh auth token -u basheer421) gh pr create --repo basheer421/agent-office --base main`. Never against upstream. Merging needs Bachir's OK.
3. Before every commit: `npm run typecheck && npm test && npm run build`. All green or don't commit. Paste the real tail of the output in the PR body.
4. `tests/size.test.ts`: no file over 600 lines (`BUDGET`). Split, don't grow. Files with a ceiling in `CEILINGS` may not grow past it.
5. New code goes in its own folders (see the design). Don't add feature code to `main.ts`, `server.ts`, the store, `protocol.ts`.
6. Every modal: top-right ✕, Esc closes, back to mouse-look with no extra click.
7. Update `README.md` + the matching `docs/*.md` when how people run/use the office changes.
8. Never touch: real `~/code/g137/*` repos, GitLab projects other than the scratch one, ClickUp writes (draft-only rule).
9. **Stop and ask Bachir** if: a step would need a real GitLab project other than the scratch one; an upstream test must be deleted (not updated); the design in `fork-architecture.md` doesn't fit what the code really does; anything needs pushing to `main`.
10. Low thinking is fine for mechanical moves. For each design choice not written here, pick the option the design doc's "Design rules" table implies, and note it in the PR body under **Decisions made**.

## 3. Progress

Tick here (in the PR that does it) so the next session knows where to start. Each open step has its GitHub issue on the fork; perf work is tracked in issues too (see `docs/plans/performance-and-remote.md`).

- [x] **P0** fork house rules
- [x] **P1a** model + ports + cli runner + architecture tests
- [x] **P1b** GitHub adapter (move `github.ts`), consumers on ports (#4, PR #30). `hosts/github/` + `trackers/github/`, `boards.ts` (board state through the ports), `ws/legacy-gh.ts` (model → `Gh*` until P1c), `github.ts` deleted, spawn allow-list empty. GitLab floors get NoHost/NoTracker with a "not yet" message until P3 wires `GitLabHost` in. Not done: the full UI live run (worker + **O** opens a PR on the fork, PR-board screenshot)
- [x] **P1c** protocol + client rename (`gh.*` → `cr.*` / `issues.*`, `ui/github/` → `ui/boards/`), issue ids → string (#5)
- [x] **P2** local projects (open folder, project config, push remote / base branch) (#6)
- [ ] **P3** GitLab adapter (#14): step 1 (`hosts/gitlab/`, not wired in) + fake-glab contract test done; steps 2–6 unblocked (P1b merged: `hosts/index.ts` `hostFor`/`hostKindOf`), live steps need a scratch project
- [ ] **P4** ClickUp tracker (only after Bachir confirms P3 works) (#15)
- [ ] **P5** GitLab per-person sign-in (only if asked) (#16)

## 4. Phase steps

### P0: fork house rules (branch `fork/house-rules`)

Also carries this plan: cherry-pick the commits of `plan/fork-architecture` first (`git cherry-pick cef2f24 e94dd55` plus any later ones on that branch), then edit `AGENTS.md`:

- PRs go to `basheer421/agent-office`, branch from `origin/main` (the fork).
- Replace the "merge only webdevcody's" line: merge Bachir's PRs when he says so; PRs from others only after a security review. Upstream is merged in only when Bachir asks (`git fetch upstream && git merge upstream/main` on a branch, as a PR, both sides survive).
- Commits as `basheer421 <basheer123b2@gmail.com>`.
- Point to `docs/plans/EXECUTION.md` and `docs/plans/fork-architecture.md`.

Check: `npm test` green (docs-only, but run it). PR.

### P1a: model, ports, CLI runner (branch `forge/ports`)

Create, no consumers changed yet:

| File | Contents |
|---|---|
| `src/shared/model/change-request.ts` | `ChangeRequest`, `ChangeRequestDetail`, `CrState = 'draft'\|'open'\|'merged'\|'closed'`, `Check`, `Review`, `Comment`, `ReviewComment`, `MergeMethod`, `CloseReason`. Field names neutral: `number`, `title`, `state`, `sourceBranch`, `targetBranch`, `url`, `author`, `labels`, `checks`, `additions`, `deletions`, `updatedAt`. Derive the field list from today's `GhPull` / `GhPullDetail` in `src/shared/protocol/github.ts`: every field the client uses must have a neutral twin |
| `src/shared/model/issue.ts` | `Issue` (`id: string`, `ref: string` like `#12` or `86c1x2`, `title`, `state`, `labels`, `url`, `assignees`, `updatedAt`), `IssueDetail`, `IssueReference` |
| `src/shared/model/label.ts` | `Label` |
| `src/shared/model/host.ts` | `HostKind = 'github'\|'gitlab'\|'none'`, `HostCapabilities`, `HostVocabulary` (`crNoun: 'pull request'\|'merge request'`, `crShort: 'PR'\|'MR'`, `refPrefix: '#'\|'!'`, `cli: 'gh'\|'glab'`), `HostError` (`kind`, `message`, `hint`) |
| `src/shared/model/tracker.ts` | `TrackerKind = 'github'\|'clickup'\|'none'`, `TrackerCapabilities` |
| `src/server/cli/run.ts` | `runCli(bin, args, { cwd, env, timeout, input })` → `{ code, stdout, stderr }`, plus `cliJson<T>()`. Move the body of `gh()` from `github.ts:19` here. Map stderr to `HostError` kinds (`auth`: "auth login"/401; `not-found`; `no-remote`; `cli-missing`: ENOENT; `rate-limit`) |
| `src/server/hosts/types.ts` | `CodeHost` interface exactly as in the design doc |
| `src/server/trackers/types.ts` | `IssueTracker` interface |
| `src/server/hosts/none.ts`, `src/server/trackers/none.ts` | Empty implementations (`list()` → `[]`, mutating calls throw `HostError{kind:'unsupported'}`) |
| `tests/architecture.test.ts` | (1) no `'gh'` / `'glab'` spawn (`execFile`/`spawn`/`runCli` with literal `'gh'`/`'glab'`) outside `src/server/cli/` and `src/server/hosts/*/` and `src/server/trackers/*/`; (2) nothing outside `src/server/hosts/index.ts` imports `hosts/github` or `hosts/gitlab`, same for trackers. **Mark the known violators as an allow-list with a comment `// P1b removes`**, so the test is green now and the list shrinks to zero in P1b |

Check: typecheck/test/build green. PR.

### P1b: GitHub adapter + consumers (branch `forge/github-adapter`)

1. `src/server/hosts/github/` (`index.ts`, `map.ts` for JSON → model, `cli.ts` for arg building): implements `CodeHost` with the PR half of today's `GitHub` class (`pullDetail`, `pullDiff`, `comment('pull')`, `review`, `merge`, `close('pull')`, `repoLabels`, `setLabels('pull')`, pulls list, `repoInfo`, `viewer`). `createdBy()` = the regex from `src/server/workers/pr.ts:21-44`. `create()` = the `gh pr create` from `src/server/changes.ts:322`.
2. `src/server/trackers/github/`: the issue half (`issueDetail`, `comment('issue')`, `close('issue')`, `claim`, `setLabels('issue')`, issues list). `Claims` moves with it.
3. `MergeWatch` (`github.ts:77`) becomes host-agnostic in `src/server/hosts/merge-watch.ts`, fed `ChangeRequest[]`.
4. `src/server/hosts/index.ts`: `hostFor(kind, ctx)` / `trackerFor(kind, ctx)` factories. For P1b kind is always `'github'` when the floor has a GitHub remote, else `'none'` (that's today's behaviour).
5. `Floor` (`src/server/floor.ts`): replace `readonly github: GitHub` with `readonly host: CodeHost` and `readonly tracker: IssueTracker`, plus the cached lists (`changeRequests`, `issues`) with `fetchedAt`/`error`. Update every `floor.github.*` (`floor.ts` lines ~77, 210-416, `leave-on-merge.ts`, `office-workers.ts`, `hooks/office-workers.ts`, `office/gates.ts`, `queue.ts`, `workers/manager.ts`, `ws/handlers/workers.ts`, `ws/handlers/github.ts`, `http/routes/github.ts`).
6. Remaining `gh` spawns outside adapters (`building.ts:548`, `clone.ts:110`, `setup.ts:209/215`, `signins.ts`, `office/services.ts:56`): clone/setup/signin are GitHub-account flows, so move their `gh` calls behind `hosts/github/account.ts` (clone, repo list, auth) and call that. `office/services.ts:56` (`resolveCommand('gh')`): keep, it only resolves a path; add to the allow-list with a comment why.
7. Delete `src/server/github.ts`. The architecture test allow-list must now be empty (except the `services.ts` path resolve).
8. Server-side types are now the model; the wire still carries the old `Gh*` shapes: add `src/server/ws/legacy-gh.ts` mapping model → `Gh*` so the client is untouched in this PR. (P1c deletes it.)
9. Update tests in `tests/github.test.ts`, `leave-on-merge.test.ts`, `server-dispatch.test.ts`, `workers.test.ts`, … to the new classes. **Change assertions only where names moved; if behaviour must change, stop and ask.**

Check: typecheck/test/build green, **and a live GitHub run**: open the office on a checkout of the fork itself (`git clone git@github.com:basheer421/agent-office.git /tmp/ao-test/ao-self`), PR board lists PRs, a worker in a worktree + **O** opens a PR on the fork (then close it). Screenshot of the PR board in the PR body.

### P1c: protocol + client rename (branch `forge/neutral-protocol`)

1. `src/shared/protocol/github.ts` → `src/shared/protocol/boards.ts`: messages `gh.pulls` → `cr.list`, `gh.issues` → `issues.list`, `gh.comment` → `cr.comment` / `issues.comment`, `gh.merge` → `cr.merge`, `gh.close` → `cr.close` / `issues.close`, `gh.labels` → `labels.list`, `gh.labeled` → `labels.changed`, `gh.refresh` → `boards.refresh` (and their replies). Payloads use the model types. Add `host: { kind, words, caps }` and `tracker: { kind, caps }` to `FloorView`.
2. Delete `legacy-gh.ts`. `ws/handlers/github.ts` → `ws/handlers/boards.ts`; `http/routes/github.ts` → `http/routes/boards.ts`.
3. Client: `src/client/ui/github/` → `src/client/ui/boards/`. Every "PR"/"pull request" string in board UI comes from `host.words`. Hide buttons whose capability is false (labels, auto-merge, reviews).
4. Issue ids: `number` → `string` everywhere (queue tasks, carrying, prompts `{{number}}` → `{{ref}}`, `issue?: number` in `worker.spawn`/`worker.prompt`). Persisted files (`queue.json`, `workers.json`) with numeric issue ids: read both, write string (migrate on load).
5. Prompts (`src/shared/prompts.ts`): replace `gh …` snippets with `{{cli.view}}`, `{{cli.diff}}`, `{{cli.checkout}}`, `{{cli.create}}`, `{{cli.merge}}` filled from `host.words`. Keep users' saved prompt overrides working (their text stays as they wrote it).

Check: green + screenshot of both boards on the GitHub test floor + the queue still seats a worker for an issue.

### P2: local projects (branch `projects/local-folders`)

1. `src/server/projects/detect.ts`: from a dir → `{ isGit, remotes[], pushRemote, url, host: HostKind, hostname, projectPath, baseBranch }` per the design's "Zero-config" table. GitLab hostnames come from ⚙️ setting `gitlabHosts` (default `['gitlab.g137.io']`).
2. `src/server/projects/store.ts`: `<project>/.agent-office/project.json` holds **overrides only**; `effective(dir)` = detect ⊕ overrides. The only reader/writer.
3. `src/server/projects/roots.ts`: allowed roots (default `~/code`, ⚙️ editable, admins). `resolveInside(path)`: `realpath`, must be inside a root, must be a directory. Reject otherwise with a reason.
4. Protocol `project.*`: `project.browse { path }` → dir listing (dirs only, marks git repos), `project.open { dir }` → new floor (admins), `project.configure { floor, overrides }`, `project.config` (effective + which fields are overridden).
5. Building: generalise `ensureLocal` (`building.ts:236`) into `openFolder(dir, by)`; `FloorDef` gains `source: 'local'\|'cloned'`; `repo` stays optional for GitHub clones.
6. Worktrees (`worktrees.ts:87,106`) fetch `<pushRemote> <baseBranch>` from project config; `changes.ts:319` pushes to `pushRemote`, CR targets `baseBranch`.
7. Client: elevator panel gets **📂 Open folder** (folder browser, breadcrumbs, git badge) next to the existing clone list (which becomes **⬇️ Clone**). Floor menu gets **⚙️ Project settings** (shows detected values greyed, override fields, ✕/Esc).
8. Tests: integration test with temp dirs: detection of a GitLab ssh URL, https URL, github URL, no remote; `resolveInside` with `..` and a symlink escaping the root; overrides round-trip.

Check: green; live: open `/tmp/ao-test/brain` via **📂 Open folder** (not as the start dir; start the office with `--home /tmp/ao-test/home` and no dir), project settings show gitlab / origin / dev, a worktree worker's branch starts at `origin/dev`.

### P3: GitLab adapter (branch `forge/gitlab`)

Needs: `glab` logged in to `gitlab.g137.io` on this machine (`glab auth status --hostname gitlab.g137.io`). **A scratch GitLab project: ask Bachir which one to use (or to create one) before the live steps.**

1. `src/server/hosts/gitlab/`: all calls via `glab api --hostname <host> <path>` (REST v4). Project id = URL-encoded `projectPath`. MR number = `iid`. Map: `opened`+`draft` → `draft`, `opened` → `open`, `merged`, `closed`; pipeline (`head_pipeline.status`) → `checks`; approvals → review state (if the API needs a premium tier and fails, `caps.reviews = false`).
   - list: `GET projects/:id/merge_requests?state=opened&per_page=100` + `state=merged&per_page=30` + `state=closed&per_page=20`
   - detail: `GET …/merge_requests/:iid`, notes `GET …/merge_requests/:iid/notes`, discussions for line comments
   - diff: `GET …/merge_requests/:iid/diffs` (fallback `…/changes`), rebuilt as unified diff
   - comment: `POST …/merge_requests/:iid/notes`
   - merge: `PUT …/merge_requests/:iid/merge` (`squash`, `should_remove_source_branch`, `merge_when_pipeline_succeeds` for auto). `caps.mergeMethods` = `['merge','squash']` (GitLab picks rebase/ff at project level)
   - close: `PUT …/merge_requests/:iid` `state_event=close`
   - labels: `GET projects/:id/labels`, `PUT …/merge_requests/:iid` `add_labels`/`remove_labels`
   - create: `POST projects/:id/merge_requests` `source_branch`, `target_branch`, `title`, `description`, `remove_source_branch=true`
   - `createdBy`: matches `glab mr create` in the command, MR URL `/-/merge_requests/<iid>` in output
   - viewer: `GET user` → `username`
2. GitLab vocabulary + prompt snippets (`glab mr view <n> --comments`, `glab mr diff <n>`, `glab mr checkout <n>`, `glab mr create --fill --target-branch <base>`, `glab mr merge <n>`).
3. Clone tab: with ⚙️ default host = GitLab, list `GET projects?membership=true&simple=true&order_by=last_activity_at`; clone with `git clone` of `ssh_url_to_repo` (not `gh`).
4. ⚙️ Settings: default host, `gitlabHosts`.
5. Contract tests: `tests/hosts/contract.ts` — one suite, run for `github` and `gitlab`, against fake binaries in `tests/fixtures/bin/{gh,glab}` (node scripts that look up `argv` in a recorded-JSON fixture map and print it; unknown args → exit 1 with the args, so missing fixtures are obvious). Prepend that dir to `PATH` in the test.
6. `scripts/e2e-gitlab.sh <host> <projectPath>`: clones the scratch project to `/tmp`, starts the office on it, hires a worker that commits a file, triggers **O**, checks the MR exists via `glab api`, merges it, checks the floor saw `merged`. Cleans up the branch.

Check: green; e2e script green on the scratch project; live on `/tmp/ao-test/brain`: MR board lists Brain's real open MRs (read-only — **do not create MRs on developers/brain**). Then ask Bachir to confirm P3 before P4.

### P4: ClickUp tracker (branch `trackers/clickup`) — only after Bachir confirms P3

Read `~/.pi/agent/skills/clickup-task-ops/SKILL.md` first. Token from the office's environment (`CLICKUP_API_TOKEN`) or ⚙️ (admins; stored in the office's `.agent-office/`, mode 600, never sent to the browser). Project override `tracker: { kind: 'clickup', listId }`; **Connect ClickUp** on the empty board picks space → folder → list. Read-only: `list()`, `detail()`, `reference()` = `ClickUp <custom_id or id> <url>`. No status/assign/comment writes. Hand to a worker / Add to queue put the task ref + URL into the prompt and the MR description. Contract test with a fake HTTP server (recorded JSON).

## 5. PR body template

```
## What
<one paragraph>

## Decisions made
- <choice not dictated by the plan, and why>

## Verification
<real tail of: npm run typecheck && npm test && npm run build>
<live check: what you did, what you saw, screenshot path>

## Plan
Ticks <phase> in docs/plans/EXECUTION.md.
```
