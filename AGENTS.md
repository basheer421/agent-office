# agent-office

- This is Bachir's fork. `origin` = `basheer421/agent-office`, `upstream` = AgentSystemLabs (push disabled). Ship every code change as a PR on the fork (`GH_TOKEN=$(gh auth token -u basheer421) gh pr create --repo basheer421/agent-office --base main`), branched from freshly fetched `origin/main`, and end with the PR URL. Never open PRs against upstream.
- Commit as `basheer421 <basheer123b2@gmail.com>` (repo-local config, worktrees inherit it).
- The fork plan lives in `docs/plans/fork-architecture.md` (design) and `docs/plans/EXECUTION.md` (steps, progress); read EXECUTION.md first when working on it.
- The main checkout is shared with other live sessions and board agents, so do branch work in a worktree and never stash, reset or commit anyone else's changes there.
- Verify with `npm run typecheck`, `npm test` and `npm run build`, plus a headless-browser screenshot for visual changes, rather than slow manual playthroughs.
- When a change affects how people run, deploy or use the office, update `README.md` and the matching `docs/*.md` page in the same PR.
- New features plug in through the registries as modules of their own (see `docs/code-layout.md`), never by adding their code to `main.ts`, `server.ts`, the state store, `protocol.ts` or another feature's files, and `tests/size.test.ts` must stay green.
- Every modal needs a top-right ✕, and closing it by ✕ or Esc must put the player straight back into mouse-look with no extra click.
- Merge Bachir's PRs only when he says so; PRs from anyone else only after a security review. Squash-merge.
- Upstream is merged in only when Bachir asks: on a branch, `git fetch upstream && git merge upstream/main`, resolve conflicts so both sides survive, ship as a PR.
