# CI fix (replaces CI triage)

## Problem

The current CI triage pipeline classifies a failing CI run as `PR_CAUSED` or
`INFRA` and, when `PR_CAUSED`, opens a GitHub issue. The PR stays red. A human
still has to pick up the issue, fix the branch, and push. The two failures seen
most often are mechanical: lint or format violations left behind by conflict
resolution, and commit messages that predate commitlint and were never reworded.

Goal: no PR babysitting. The agent reads the CI output, fixes the branch, and
pushes so CI goes green. Introspection about why the failure escaped to CI is
worth keeping but must never block the fix.

## Approach

Keep the existing two-tick spawn/resolve structure and change the agent's job
from classify to fix. The phase key, actions, and context/output filenames move
from `ci-triage` to `ci-fix`.

Rejected alternatives:

- **Fold into the implementation-revision path.** Reuses existing machinery, but
  implementation phases are expensive, re-read the whole spec, and would fight
  the `implementation/waiting` state.
- **Deterministic fixers first.** Faster and cheaper for the two common cases,
  but AGENTS.md rules out deterministic pattern matching on CI failures, and the
  fixers rot as CI changes.

## Tick 1 — `spawnCIFixAction`

Replaces `spawnCITriageAction` (`src/tick-actions/spawn-ci-triage.ts` →
`spawn-ci-fix.ts`).

`applies` is unchanged: the ticket has at least one unmerged PR, is not
`needs-attention`, and no phase process is live.

Changes:

- **Actions API instead of check-suites.** `getPRChecks` queries
  `/repos/{repo}/actions/runs?head_sha=<pr head sha>` rather than
  `/commits/{sha}/check-suites`. This yields the workflow run ID the agent needs
  for `gh run view --log-failed` (today the agent has to discover it via
  `gh pr checks`) and the `run_attempt` number.
- **Dedup key is `${runId}-${attempt}`.** Recorded in `ciHandledRunIds` as
  before. Keying on run ID alone would break the INFRA re-run path: a
  `gh run rerun` keeps the same run ID and only increments the attempt, so every
  re-run failure would be silently swallowed.
- **Missing worktree parks the ticket.** If the PR's `worktreeKey` resolves to
  nothing in `ticket.worktrees`, set `needs-attention` with reason
  `no-worktrees` and do not spawn. The agent cannot commit or push without a
  worktree, and worktree creation is `createWorktreeAction`'s job.
- **Context file drops the PR diff.** The agent has the worktree; a full patch
  dump only burns context. The file carries `PR-URL`, `Repo`, `Run-ID`,
  `Attempt`, `Branch`, `Worktree-Path`, and the failing job names.

Filename: `${timestamp}-ci-fix-context-${runId}-${attempt}.md`.

Failure handling is unchanged: if `writeContextFile` or `spawn` throws, the
dedup key is removed from `ciHandledRunIds`, the error is logged, and processing
continues to the next PR.

## Tick 2 — `resolveCIFixAction`

Replaces `resolveCITriageAction` (`src/tick-actions/resolve-ci-triage.ts` →
`resolve-ci-fix.ts`). Detects finished runs by a `*-ci-fix-context-*.md` file
present with no live process, and derives the output filename by replacing
`-ci-fix-context-` with `-ci-fix-`.

Verdict parsed from the first line matching
`/^VERDICT:\s*(FIXED|INFRA|UNFIXABLE)/im`:

| Verdict     | Action                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIXED`     | `git push --force-with-lease origin <branch>` from the worktree; log `branch-pushed`. Push failure → `needs-attention`, reason `push-failed`. Then write the learning if a `LEARNING:` line is present. |
| `INFRA`     | `gh run rerun --failed --repo <repo> <run-id>`. No push, no code change. A rerun failure is logged and processing continues — it never parks the ticket.                                                |
| `UNFIXABLE` | `needs-attention`, reason `ci-unfixable`.                                                                                                                                                               |

Missing output file → `needs-attention`, reason `output-file-missing`. No
verdict line → `needs-attention`, reason `no-verdict-line`. Both unchanged from
today.

Context and output files are removed after resolution in every case. A
`ci-fix-resolved` log entry records `prUrl`, `runId`, `attempt`, and `verdict`.

The action does not otherwise touch `ticket.phase` or `ticket.status`: on
`FIXED` and `INFRA` the ticket stays `implementation/waiting`, and the next tick
observes the new CI run.

**Deleted:** the `createGitHubIssue` dependency and the issue-creation path.

**Kept:** `writeLearning`, fired only on `FIXED` with a `LEARNING:` line,
wrapped so a failure cannot affect the fix path.

`resolveCIFixAction` must stay registered before `spawnCIFixAction` in
`tickActions` so a completed fix run is resolved before the spawn action can
re-evaluate the same ticket. Both remain gated on
`config.tick.resolveCIFailures` (name unchanged — still accurate).

## Agent prompt

Phase key `ci-fix`; `PHASE_MODEL_DEFAULTS` entry
`{ model: "claude-sonnet-4-6", thinking: "high" }`, overridable via
`[phases.defaults.ci-fix]` or `ticket.phases["ci-fix"]`. The prompt stays inline
in `compose.ts`, consistent with `conflict-resolution`.

Instructions, in order:

1. Read the context file for the run ID, repo, branch, and worktree path. Work
   in the worktree.
2. `gh run view --repo <repo> <run-id> --log-failed` for the real failure
   output. Identify the exact command the failing job ran by reading
   `.github/workflows/`.
3. Decide whether the failure is fixable from the PR side or is infrastructure —
   network error, rate limit, runner timeout, package download failure, flake
   with no code correlation. Default to fixable; a red run on a PR branch is
   overwhelmingly the PR's fault.
4. Fix it in the worktree. Reproduce the failure locally with the job's own
   command, fix, re-run that command, and confirm it passes before claiming
   `FIXED`. Two cases called out explicitly:
   - **Lint or format** — run the repo's check command (`deno fmt`, `deno lint`,
     or equivalent) and commit the result.
   - **Commit message / commitlint** — reword rather than adding a commit.
     Prefer `git commit --amend -m` when only the tip commit is bad; for older
     commits use a non-interactive rebase driven by `GIT_SEQUENCE_EDITOR` and
     `GIT_EDITOR`; as a last resort
     `git reset --soft $(git merge-base origin/<base> HEAD)` and re-commit with
     a conforming message.
5. Commit, but do not push — `resolveCIFixAction` owns the force-push. Do not
   create pull requests or issues.
6. End with exactly one line: `VERDICT: FIXED`, `VERDICT: INFRA`, or
   `VERDICT: UNFIXABLE`. On `FIXED`, follow it with
   `LEARNING: <one or two sentences on what the implementation phase should have
   checked to catch this before CI>`.

The commit/push split is deliberate: it keeps `--force-with-lease` and the
`branch-pushed` / `push-failed` logging deterministic and unit-testable,
matching `resolveConflictsAction`.

## Retry behavior

Attempts are unlimited; the only dedup is the `${runId}-${attempt}` key. A fix
push produces a new workflow run, so a still-red PR is picked up again on the
next tick.

Accepted risk: an agent that fixes one lint error while introducing another
loops indefinitely, one tick per cycle, with nothing parking the ticket.
`UNFIXABLE` is the only brake and depends on the agent's judgment. A per-PR
attempt counter was considered and deliberately not included.

## Testing

`spawn-ci-fix_test.ts`:

- Same run ID with an incremented attempt spawns; an identical `runId-attempt`
  key does not.
- A PR whose `worktreeKey` is absent from `ticket.worktrees` parks with
  `no-worktrees` and does not spawn.
- `writeContextFile` or `spawn` throwing rolls the key back out of
  `ciHandledRunIds` and continues to the next PR.
- A non-failing conclusion is skipped.

`resolve-ci-fix_test.ts`:

- `FIXED` force-pushes the worktree branch and logs `branch-pushed`.
- `FIXED` with a failed push parks with `push-failed`.
- `INFRA` re-runs the failed jobs and does not push.
- `UNFIXABLE` parks with `ci-unfixable`.
- Missing output file and missing verdict line each park.
- `writeLearning` is called only on `FIXED` with a `LEARNING:` line.
- Context and output files are removed in every path.

Both suites stub `runGit`, `spawn`, and the GitHub calls with `spy`/`stub` from
`@std/testing/mock`. No real git processes and no network.

## Documentation

- Rewrite the "CI triage" section of `AGENTS.md` as "CI fix": new verdicts, new
  filenames, new phase key, the deleted issue path, and the commit/push split.
- Add `ci-fix-resolved` to the `log.ndjson` event table and `ci-unfixable` to
  the `reason` label list; remove `ci-triage-resolved`.
- Update the `ci-triage` reference in `.claude/skills/lazyboy-config/SKILL.md`.
- Note in the Bedrock section that `ci-fix` (not `ci-triage`) is the phase key
  Bedrock users must override.
