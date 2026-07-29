# Agent Instructions

This file provides guidance to coding agents (Claude Code, Pi, etc.) working in
this repository.

## Non-Deno dependencies

These must be present on the host; they are not managed by Deno.

| Dependency                    | Purpose                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `git`                         | Worktree management, rebase/push, state repo commits                                                                            |
| `pi`                          | Runs phase prompts; checks/installs agent packages                                                                              |
| `crontab`                     | Installs and removes the tick cron job                                                                                          |
| GitHub API (`api.github.com`) | Fetches assigned issues; checks PR merge status                                                                                 |
| `apfel`                       | Runs local LLM server for approval classification in review mode (optional; falls back to Anthropic when absent or unavailable) |

Environment variables required at runtime (tick only): `ANTHROPIC_API_KEY` plus
either `GITHUB_TOKEN`/`GITHUB_LOGIN` (single-account setups) or the `token_env`
variables named in `[github.accounts.*]` (multi-account setups). See
`resolveGitHubAccount` in `src/compose.ts`.

## Commands

```bash
deno task test                          # run all tests
deno test --allow-all src/foo_test.ts  # run a single test file
deno task start tick                    # run the tick loop once
deno run --allow-all src/index.ts status

notion-fetch page <url>           # fetch a Notion page as Markdown (requires NOTION_TOKEN)
notion-fetch database <url>       # fetch a Notion database as a Markdown table
notion-fetch search <query>       # search the Notion workspace
```

Runtime env vars required for `tick`: `ANTHROPIC_API_KEY` plus either
`GITHUB_TOKEN`/`GITHUB_LOGIN` (single-account) or the `token_env` variables from
`[github.accounts.*]` (multi-account). Config is read from
`~/.config/lazyboy/config.toml`.

## Architecture

lazyboy is a cron-driven autonomous pipeline. `bin/lazyboy` → `src/index.ts`
dispatches to three subcommands: `tick`, `approve`, `status` (plus
`enable`/`disable` for cron management via `src/cron.ts`).

**Tick loop**: `src/commands/tick.ts` loads config, calls `composeTickDeps` from
`src/compose.ts` to build all adapters, then calls
`new TickService(deps).run()`. `TickService` (`src/tick.ts`) owns the workflow:
acquire lock → install packages → fetch new work → migrate → action pass →
advance pass → commit. No adapter construction happens inside `TickService`.
`advancePhase` is dependency-injected (`TickDeps`) to keep it unit-testable
without real filesystem or process access.

**Composition root** (`src/compose.ts`): `composeTickDeps(config)` is the single
site where all concrete adapters are constructed. It resolves GitHub credentials
via `resolveGitHubAccount(org, config)` — which reads from `Deno.env` using the
per-org account map in `config.github` when configured, or falls back to
`GITHUB_TOKEN`/`GITHUB_LOGIN` — and reads `ANTHROPIC_API_KEY`, `JIRA_EMAIL`,
`JIRA_API_TOKEN` directly from `Deno.env`, plus `HOME` to build `~/.lazyboy`
paths. No other module reads adapter credentials from `Deno.env`;
`appendTickLog` in `src/tick.ts` separately reads `HOME` to locate
`~/.lazyboy/tick.ndjson`.

**Lock** (`src/lock.ts`): the `Lock` interface (`withLock(fn)`) is satisfied by
`PidFileLock`, which takes the pid-file path plus a `PidFileLockDeps` object
(`{ log, isPidAlive? }`) — it has no knowledge of `tick.ndjson`, `Deno.env`, or
`TickService`, and only decides its own lock-acquisition states
(`tick-already-running`, `stale-lock`, `lock-failed`) via the injected `log`
callback. If the lock cannot be acquired, `withLock` returns without calling
`fn`. If `fn` throws, `withLock` releases the pid file and re-throws.
`TickService.run()` wraps its own workflow in a `try`/`catch` inside the
callback it passes to `withLock`: on failure it calls `appendTickLog` with a
`tick-failed` entry and re-throws, so the outer `try` in `run()` can log to
`console.error` and call `exit(1)`. `composeTickDeps` wires `PidFileLock`'s
`log` dependency to `appendTickLog`.

**Phase state machine**: tickets carry two fields — `phase: TicketPhase` and
`status: TicketStatus`. Status transitions are
`new → running → waiting → (approved) → running` cycling through phases in
`PHASE_SEQUENCE`. When an `implementation` agent exits, the ticket stays in
`implementation/waiting` for review. Once approved, it transitions to
`merge/waiting`. `PHASE_SEQUENCE` covers only the five runner phases (`intake`
through `implementation`); `merge` is handled explicitly in `advancePhase`. Any
phase can transition to `needs-attention` on subprocess failure.
`{ phase: "merge", status: "done" }` is the terminal state.

**Approval log**: `TicketState.approvals` is an `ApprovalEntry[]` array (defined
in `src/state/types.ts`). Each entry records `timestamp` (ISO 8601), `actor`
(`"human"` | `"agent"` | `"unknown"`), and `phase`. The `isApproved` helper
(exported from `src/state/types.ts`) gates phase advancement: it returns `true`
iff the last entry's `phase` matches `ticket.phase`. Human approvals are written
by `performApprove` in `src/commands/approve.ts`; agent approvals are appended
by `advancePhase` in `src/tick.ts` after a successful self-review. There is no
single boolean `approved` field — do not add one.

**Executor** (`src/executor.ts`): `spawnPhase()` launches `src/run-phase.ts` as
a detached Deno subprocess. The subprocess runs
`pi --mode json --approve "<prompt>" @/ticket/meta.md` with the ticket directory
(or worktree path during implementation) as `cwd`. Stdout is NDJSON;
`extractUsageAndText` in `run-phase.ts` reconstructs the assistant text for the
phase output file and aggregates token usage. After the subprocess exits, two
files are written: the phase output `.md` and a sidecar
`<timestamped-phase>.usage.json` (omitted if no `agent_end` event was received).
`spawnPhase()` also writes the child PID to `<ticketDir>/run.pid`. The tick
detects completion by calling `isPhaseAlive(ticketDir)` on the next run; when
the process is dead, the pidfile is deleted and the ticket transitions to
`waiting`. `run.pid` is never committed to git (gitignored at the state-repo
root).

**State store** (`src/state/store.ts`): each ticket is a directory in the
configured `state.dir` git repo. `meta.md` uses YAML frontmatter (parsed via
`gray-matter`) for structured fields; the body is free text. Phase output files
(`intake.md`, `enrichment.md`, etc.) live alongside `meta.md`.

**Phase prompts** (`src/phases/prompts/*.md`): one prompt template per phase,
loaded at runtime by `src/phases/runners.ts`. Prompt filenames must match the
`ActivePhase` values in `src/phases/types.ts` (`intake`, `enrichment`, `spec`,
`plan`, `implementation`).

**Provider-specific prompt supplements**
(`src/phases/prompts/<provider>-<phase>.md`): optional per-provider additions to
a phase prompt. When a file named `<provider>-<phase>.md` exists in the same
directory, `loadProviderPrompt` in `src/phases/runners.ts` reads it and
`advancePhase` appends its contents to the base prompt, separated by a blank
line. When the file is absent, the base prompt is used unchanged — no code
change is needed to add supplement support for a new provider or phase.
Currently only `github-implementation.md` exists.

**Self-review prompts** (`src/phases/prompts/*-self-review.md`): one optional
prompt per phase. When present, `selfReview` in `src/self-review.ts` calls the
Anthropic API after a `running → waiting` transition and, if the response is
`APPROVE`, `advancePhase` appends an `ApprovalEntry` with `actor: "agent"` to
`ticket.approvals`. When absent for a phase, self-review is skipped and the
ticket waits for human approval as before. Self-review prompts currently exist
for `intake`, `enrichment`, and `spec`.

## Key constraints

- `advancePhase` is pure except for the injected `TickDeps` — keep it that way
  for testability.
- The state dir is a separate git repo (`~/code/jackjennings/projects` by
  default). `commitState` runs `git add -A && git commit` inside it after each
  tick.

## Usage sidecar files

Each phase run writes a `<timestampedPhase>.usage.json` file alongside the phase
output `.md` in the ticket directory. The file contains the fields of
`PhaseUsage` (`input`, `output`, `cacheRead`, `cacheWrite`, `model`,
`durationMs`, and optionally `costUsd` and `tools`). `costUsd` is the calculated
cost in USD based on Anthropic's published pricing; it is absent when pricing is
unavailable or the model is not found in the cache. `tools` is a
`Record<string, number>` mapping lowercased tool names to call counts for the
phase; it is absent when no tool calls occurred. Optional fields on `PhaseUsage`
are omitted from the sidecar when absent — never written as `null` or `{}`.
`reasoning` tokens are excluded. Files are written only when `pi` exits with a
complete `agent_end` event. Code that scans ticket directories (e.g.
`lazyboy status`) identifies usage files by the `.usage.json` suffix.

## Background analysis subprocesses

Non-phase background agents (processes that run alongside a ticket's main phase
agent without participating in the phase state machine) write a custom PID file
instead of `run.pid`. The tick loop only reads `run.pid` to track phase agent
liveness, so a subprocess writing a different PID file is invisible to ticket
state management.

The outlier analysis agent (`src/phases/prompts/outlier-analysis.md`) is the
current example: it is spawned by `spawnOutlierAnalysis` in `TickDeps` and
writes `outlier-analysis.pid` via the `pidFile` option on `ExecutorOptions`.

To add a new background subprocess:

- Give it a distinct `pidFile` name that does not conflict with `run.pid`.
- Add an optional method to `TickDeps`; the call site in `advancePhase` guards
  with `?.`.
- Wire the concrete implementation in `composeTickDeps`.
- Never write to `ticket.status` or `ticket.phase` from the subprocess.

## Provider-specific prompt supplements

`loadProviderPrompt(phase, provider)` in `src/phases/runners.ts` loads
`src/phases/prompts/<provider>-<phase>.md` and returns `""` when absent.
`advancePhase` calls it at every prompt-loading site and appends the result with
`\n\n` when non-empty.

To add a supplement for a new provider or phase, create the corresponding `.md`
file in `src/phases/prompts/`. No code changes are required. Supplement files
must not contain `gh pr create` — the implementation-revision path uses the same
supplement as the initial implementation, and the revising prompt already
handles PR creation differently.

## State directory prompt supplements

`loadStatePrompt(phase, stateDir)` in `src/phases/runners.ts` reads
`{stateDir}/prompts/{phase}.md` and returns `""` when absent. `advancePhase`
calls it at every prompt-loading site and appends the result last — after the
provider supplement — with `\n\n` when non-empty.

To add a user-level supplement for any phase, create
`{stateDir}/prompts/{phase}.md`. No code changes are required. The phase name
must match an `ActivePhase` value (`intake`, `enrichment`, `spec`, `plan`,
`implementation`). For `implementation`, the same file applies to both the
normal implementation run and the implementation-revision run.

The prompts directory lives at the root of the state directory, not inside any
ticket subdirectory:

```
{stateDir}/
  prompts/
    intake.md
    enrichment.md
    spec.md
    plan.md
    implementation.md
  {ticket.id}/
    ...
```

## Principles file

`{stateDir}/principles.md` is a persistent scratchpad that accumulates learnings
across all tickets. Every phase prompt includes an optional `## Principles`
section: if the agent writes content there, `advancePhase` in `src/tick.ts`
calls `deps.appendPrinciples`, which appends the extracted text to
`principles.md` and commits it immediately with `commitPrinciples` from
`src/state/store.ts` (stages only `principles.md`, not the full state dir).
Before writing, `appendPrinciples` runs the extracted block through
`dedupePrinciples(existing, extracted)` (pure, in `src/run-phase.ts`), which
drops any bullet whose whitespace-normalized text already appears in the file
(or earlier in the same block) and returns `null` when nothing is novel — in
which case no write or commit happens.

`buildContextFiles` in `src/run-phase.ts` prepends `@{stateDir}/principles.md`
to every phase's context file list when the file exists. This is how accumulated
learnings feed back into subsequent phases without any agent having to
explicitly reference it.

`extractPrinciples(content)` is the pure parsing function (also in
`src/run-phase.ts`). It extracts the body of the first `## Principles` section,
returning `null` when the section is absent or empty. `advancePhase` gates the
`appendPrinciples` call on this check, so no disk I/O or git commit fires when
the phase output lacks a `## Principles` section.

`stateDir` is now threaded from `ExecutorOptions` through `buildPhaseArgs` as
the `--state-dir` CLI flag into the `run-phase.ts` subprocess. This is the only
way the subprocess knows where to find `principles.md` at context-file time.

## `tick.ndjson` format

`~/.lazyboy/tick.ndjson` uses NDJSON format — one JSON object per line, each
with a `ts` field (ISO 8601 UTC) and an `event` field. The four events are:

- `tick-already-running` — another tick process holds the lock within the
  staleness threshold
- `stale-lock` — a live PID holds the lock beyond `STALE_LOCK_MS`
- `lock-failed` — `Deno.writeTextFile` for the PID file threw
- `tick-failed` — the workflow run inside `TickService.run()`'s `withLock`
  callback threw

The cron line generated by `cronLine()` must **not** redirect stdout/stderr to
`tick.ndjson`. The tick process owns its own writes. Do not add
`>> ... tick.ndjson 2>&1` back to the cron line.

`appendTickLog` in `src/tick.ts` is exported and writes directly to this file;
it is not the same as `appendTicketLog` in `src/state/store.ts`. `PidFileLock`
does not call it directly — `composeTickDeps` passes it as `PidFileLock`'s
injected `log` dependency for the `tick-already-running`/`stale-lock`/
`lock-failed` events, and `TickService.run()` calls it directly for
`tick-failed` before re-throwing, then logs to `console.error` and calls
`exit(1)` once the error reaches its outer `try`.

## Self-review

`selfReview` in `src/self-review.ts` is the only module that reads
`*-self-review.md` prompt files and makes self-approval API calls. Do not add
Anthropic API calls for automated approval in any other module. Tests for
`selfReview` live in `src/self-review_test.ts` and use an injected `fetcher` spy
— no real network calls.

To add self-review support for a new phase, create
`src/phases/prompts/<phase>-self-review.md` with a system prompt that instructs
the model to respond with exactly `APPROVE` or `REJECT`. No code changes are
required.

## Dependency injection

Several modules expose a `*Deps` interface for testing (`TickDeps`,
`TickServiceDeps`, `InstallDeps`, `PidFileLockDeps`). Keep the surface minimal —
only inject what tests actually need to substitute.

`TickServiceDeps` is the full dependency surface of `TickService`. All adapter
construction lives in `composeTickDeps`; tests use plain object literals to
satisfy `TickServiceDeps` without touching the filesystem, git, or network.

Production helpers that satisfy a `*Deps` interface live in the same module as
the interface and are named tool-agnostically. `isPackageInstalled` belongs next
to `InstallDeps` in `src/packages.ts`; the fact that it shells out to `pi` is an
implementation detail, not part of the name.

`PidFileLockDeps` (`{ log, isPidAlive? }`) in `src/lock.ts` is the deliberate
exception: its `log` implementation (`appendTickLog`) lives in `src/tick.ts`,
not `src/lock.ts`, because `PidFileLock` must have zero knowledge of
`tick.ndjson` or any other tick-specific concept — `composeTickDeps` is what
wires the two together.

## CodeAgent adapters

Code-agent runtimes (CLI tools or SDKs that execute phase prompts) implement the
`CodeAgent` interface from `src/agents/types.ts`. Two production adapters exist:
`PiCodeAgent` in `src/agents/pi.ts` (shells to `pi`) and `ClaudeCodeAgent` in
`src/agents/claude-code.ts` (shells to `claude`, the Claude Code CLI). The `pi`
CLI must not be referenced by name outside `src/agents/pi.ts`; the `claude` CLI
must not be referenced by name outside `src/agents/claude-code.ts`.

Which adapter runs is a single global `config.toml` setting (`[agent].type`,
default `"pi"`), orthogonal to `[pi].provider` (which only takes effect when
`agent.type === "pi"`). It is resolved once in `composeTickDeps` and threaded
through `ExecutorOptions.agent` → `buildPhaseArgs`'s `--agent` flag →
`run-phase.ts`'s CLI parsing → the `import.meta.main` block, which is the only
place either adapter is constructed. `executePhase` uses the same value to pick
between the pi-specific and Claude-Code-specific NDJSON parsers
(`extractUsageAndText`/`extractSessionId` vs
`extractClaudeCodeUsageAndText`/`extractClaudeCodeSessionId`, both in
`src/run-phase.ts`), since the two CLIs' `stream-json` schemas are structurally
different.

`ClaudeCodeAgent` is Anthropic-direct only — it does not support Bedrock, and
ignores the `provider` field `runPhase` receives. Its `thinking` levels map to
the `claude` CLI's `--effort` flag (`low`/`medium`/`high`/`xhigh`/`max` pass
through unchanged; `off`/`minimal` omit the flag, since `--effort` has no
equivalent choices). It has no `@file` context-file mechanism like `pi`, so
`contextFiles` are instead listed in the prompt text and their parent
directories are passed via `--add-dir`.

Every invocation always passes `--setting-sources project,local`. Without it, a
nested `claude` process loads the operator's full personal environment —
user-level hooks, skills, plugins, and MCP servers — into whatever ticket phase
is running, which `pi` never does (it isolates its own config dirs via
`PI_CODING_AGENT_DIR`). It also always passes `--verbose`, which the CLI
requires whenever `--print` and `--output-format stream-json` are combined.

New adapters belong in `src/agents/<name>.ts` and must implement `CodeAgent`.

Arg-builder functions (`buildPiArgs`, `buildClaudeCodeArgs`) take a single
options object with named keys, not positional parameters. New adapters must
follow the same signature style.

### Bedrock support

Setting `[pi] provider = "bedrock"` in `config.toml` runs every phase through
`pi --provider bedrock` instead of the direct Anthropic API. Two things are the
user's responsibility, not lazyboy's: model IDs configured anywhere in
`config.toml` (`[phases.defaults.<phase>].model`) must already carry the Bedrock
`anthropic.` prefix (e.g. `anthropic.claude-opus-4-8`, not `claude-opus-4-8`) —
lazyboy does not rewrite model strings based on provider — and `AWS_REGION`
(plus AWS credentials, via env vars, a shared profile, or an instance role) must
be present in the environment `executePhase` inherits, since `executePhase`
already spreads `Deno.env.toObject()` into the `pi` subprocess's environment.

`PHASE_MODEL_DEFAULTS` in `src/tick.ts` is unprefixed, so any phase not
explicitly overridden in `[phases.defaults]` will send an unprefixed model ID
under `provider = "bedrock"` and fail — Bedrock users must override every phase,
including `"conflict-resolution"` (see the Conflict resolution section below),
the same way as the five runner phases.

## Imports

Use the project's import conventions from `deno.json`. For test assertions, use
`@std/assert` (bare specifier) — not `jsr:@std/assert` or
`https://deno.land/std@...` URLs.

For test doubles (spies, stubs), use `spy` and `stub` from `@std/testing/mock`
(bare specifier). Do not write hand-rolled stub functions for the same purpose.
Access recorded calls via `spy.calls` and assert call counts with
`assertSpyCalls`.

## Date and time

Use the Temporal API (`Temporal.Now`, `Temporal.PlainDate`, `Temporal.Instant`,
etc.) in preference to `Date`. Avoid `new Date()` or `Date.now()` unless
interfacing with an API that requires a legacy `Date` object.

For generating compact filename timestamps (`YYYYMMDDTHHMMSS`), use
`compactTimestamp` from `src/timestamp.ts`. Do not inline the year/month/day
padding logic at call sites.

## Code style

Do not add comments or docblocks. The code should be self-explanatory through
naming. Only add a comment when explaining a non-obvious constraint or
workaround.

## Formatting

Run `deno fmt` and `deno lint` after writing all files and before committing,
including when the only files changed are Markdown (`.md`). `deno fmt` formats
Markdown as well as source — do not skip it just because no `.ts` files changed.
Do not manually adjust indentation or spacing — let the formatter handle it.

## Planning

Every task in a plan must produce a code change and a commit. Do not create
tasks that only run verification commands without making changes.

## Tick actions

New per-tick behaviors are added as `TickAction` implementations in
`src/tick-actions/`. Each action exports a `*Deps` interface, a factory
function, and a corresponding `*_test.ts` file following the pattern in
`check-merged-pr.ts`. Actions are registered in `src/tick.ts`.

The applies predicate for actions that operate on worktrees must exclude tickets
where `isPhaseAlive(ticketDir)` returns true (i.e.
`!deps.isProcessAlive(ticket.id)` is false) — rebasing or pushing while a live
agent holds the worktree corrupts the agent's git state. Actions that can
transition a ticket to `needs-attention` must also exclude
`status === "needs-attention"` to avoid an infinite retry loop.

## PR tracking

Ticket state uses a `prs?: PrEntry[]` array (defined in `src/state/types.ts`) to
track pull requests. The legacy `prUrl?: string` field has been removed.

When the implementation agent creates a PR, it appends a `PrEntry` to `prs` in
`meta.md`. Each entry carries `url`, `title`, `dependsOn` (PR URLs that must
merge first), `merged` (always `false` on creation), and `worktreeKey` (the key
into `ticket.worktrees` for the branch this PR was cut from).

`checkMergedPRAction` iterates `prs` in order, honouring `dependsOn`
relationships. A PR is only checked for merge once all its `dependsOn` entries
are marked `merged: true`. When a PR merges its associated worktree is cleaned
up immediately; the ticket reaches `done` only when every entry in `prs` is
merged.

Do not introduce a `prUrl` field or any other single-PR field on `TicketState`.

## `runGit` in `src/worktree.ts`

`runGit` is the shared helper for shelling out to git. It is exported so
`TickAction` implementations can inject it as a dep and test against a stub. Its
return type is `{ code: number; stdout: string; stderr: string }`. Do not
introduce a second git-shelling helper — use or inject `runGit`.

## Conflict resolution

When a rebase conflict is detected, `checkConflictsAction` writes a
`${timestamp}-conflict-context-<branch>.md` sentinel file to the ticket
directory and spawns a conflict-resolution agent. The timestamp is
`YYYYMMDDTHHMMSS` (from `compactTimestamp`) captured at the moment
`writeContextFile` is called; both the context file and the output file
(`${timestamp}-conflict-resolution.md`) carry the same timestamp. Its model and
thinking level follow the same per-phase resolution as the five runner phases
(`config.toml` defaults, ticket overrides, falling back to
`claude-opus-4-7`/`high`) under the phase name `"conflict-resolution"`. The
agent receives only `@meta.md` and `@${timestamp}-conflict-context-<branch>.md`
as context (not the full `buildContextFiles` set). The worktree is left in the
mid-rebase state for the agent to resolve.

`resolveConflictsAction` detects completed conflict-resolution runs by checking
for files matching `*-conflict-context-*.md`
(`includes("-conflict-context-") &&
endsWith(".md")`) in the ticket directory
when a running ticket's PID dies. Worktree matching uses a suffix check
(`path.endsWith("-conflict-context-<safeBranch>.md")`) rather than exact
reconstruction, so the timestamp in the filename does not need to be known at
match time. It must be registered **before** `checkConflictsAction` in the
`tickActions` array so a just-finished resolution run is handled before the
conflict check can re-fire.

To spawn an agent with a non-default model or an explicit context-file list, set
`model` and/or `contextFiles` on `ExecutorOptions`. `run-phase.ts` accepts
`--model` (default `claude-sonnet-4-6`) and `--context-files` (comma-separated
`@file` paths; omit to use `buildContextFiles`). Do not hardcode the model
elsewhere.

## Migrations

Migration files live at `migrations/<UNIX_TIMESTAMP_SECONDS>-<kebab-slug>.ts`
(e.g. `1700000000-add-provider-done.ts`) — this is a root-level directory,
sibling to `src/`. The runner infrastructure (`types.ts`, `runner.ts`,
`runner_test.ts`) stays in `src/migrations/`. The numeric prefix is the ordering
and identity key. The runner filters filenames matching `/^\d+-[a-z0-9-]+\.ts$/`
and sorts them lexicographically. All future migration data files must use this
kebab-case format.

Applied migration IDs are recorded globally in `<stateDir>/.migrations`, one ID
per line. There is no per-ticket migration log and no rollback mechanism.

The `Migration.run` method receives two arguments: the `TicketState` being
migrated and the `stateDir` string (the path to the state git repository). Use
`stateDir` for any filesystem operations on ticket directories or git log
queries inside the migration.

Each migration file at `migrations/<timestamp>-<slug>.ts` should have a
companion test at `migrations/<timestamp>-<slug>_test.ts`. Migration tests are
included in `deno task test` (the test task covers both `src/` and
`migrations/`). Tests should verify behaviour directly against the
`migration.run()` function using a real temp directory.

A migration that changes `ticket.id` must move the ticket's on-disk directory
with `Deno.rename` (creating the destination's parent with
`Deno.mkdir(..., { recursive: true })` first), never `Deno.remove`. The runner
only ever writes `meta.md` back to the new location — every other file
(`log.ndjson`, phase outputs, `.usage.json`) survives solely because the
migration moved them. A migration test that only asserts the old directory is
gone is not sufficient; it must also assert file contents exist at the new path
(a prior migration deleted the old directory outright and passed review because
its test never checked this, destroying history for every ticket it touched).

## Per-org GitHub credentials

`resolveGitHubAccount(org, config)` in `src/compose.ts` is the single function
that maps a GitHub org slug to a `{ token, login }` pair.

- If `config.github.accounts` is absent: returns `GITHUB_TOKEN` / `GITHUB_LOGIN`
  from the environment (single-account fallback; existing behavior unchanged).
- If `config.github.accounts` is present and the org appears in
  `config.github.orgs`: returns the token from the env var named by
  `account.tokenEnv` and the configured `login`.
- If `config.github.accounts` is present but the org is not mapped: silently
  falls back to `GITHUB_TOKEN` / `GITHUB_LOGIN`.

All call sites in `composeTickDeps` that previously captured a single `token`
closure now call `resolveGitHubAccount` per operation. `GitHubProvider`
constructor takes `accountResolver: (org: string) => { token, login }` instead
of a single `token` / `login`.

`spawnPhase` sets both `GITHUB_TOKEN` and `GH_TOKEN` to the resolved token so
the `gh` CLI (which prefers `GH_TOKEN`) uses the correct account even if a
different value is inherited from the parent shell.

To configure multi-account access, add to `config.toml`:

```toml
[github.accounts.personal]
token_env = "GITHUB_TOKEN_PERSONAL"
login     = "jackjennings"

[github.accounts.work]
token_env = "GITHUB_TOKEN_WORK"
login     = "jack-jennings-sdx"

[github.orgs]
jackjennings = "personal"
smarterdx    = "work"
```

`loadConfig` validates that every `token_env` value is set in the environment at
startup and that every `[github.orgs]` entry references a known account name.

## Ticket ID format

Ticket IDs encode the provider and, for providers where IDs are not globally
unique, the repository as a path-like string.

**GitHub**: `github/<org>/<repo>/<issue-number>` — e.g.
`github/jackjennings/lazyboy/23`. The numeric suffix has no prefix; `github/` in
the path makes the `gh-` prefix redundant.

**Jira**: `jira/<issue-key>` — e.g. `jira/PROJ-123`. Jira keys are globally
unique per instance, so no org/project component is needed beyond the provider
prefix.

The ID is a valid POSIX relative path. `@std/path`'s `join(stateDir, id, ...)`
resolves it correctly on all platforms. Slashes in IDs are intentional — they
create the namespaced directory structure under `stateDir`.

Do not introduce new ID formats that omit the provider prefix or that use a flat
single-segment string.

## `codebase.roots` semantics

`codebase.roots` entries must be base code directories (e.g. `~/code`), not
org-scoped directories (e.g. `~/code/myorg`). `findLocalRepo` searches exactly
two levels deep: `root/<org>/<repo>`. Config examples and test fixtures must use
org-less paths.

## Remote repository cache

When a scope entry is a GitHub slug (`org/repo`) or GitHub URL and no local
checkout is found, `cloneRemoteRepo` in `src/worktree.ts` clones the repository
to `~/.lazyboy/repositories/<org>/<repo>`. The actual `gh repo clone` subprocess
is delegated to `GitHubProvider.clone(slug, destDir, cwd)`, which resolves the
per-org token via `accountResolver` and runs `gh` with only `PATH`, `HOME`, and
`GH_TOKEN` in the subprocess env — no other parent-process vars are forwarded.
`cloneRemoteRepo` accepts the clone function as a dependency injection (second
argument), keeping the filesystem logic in `worktree.ts` and the credential and
subprocess logic in `GitHubProvider`. This path is hardcoded parallel to
`~/.lazyboy/worktrees/`.

Existing entries in `~/.lazyboy/repositories/` are reused without re-cloning. No
`git fetch` or `git pull` is run on cached clones — they are persistent
snapshots.

`createWorktreeAction` fires at
`phase === "intake" && status === "waiting" && isApproved(ticket) === true`
(after intake self-review or manual `approve`). It reads the latest
`*-intake.md` file via the `readIntakeOutput` dep, resolves all GitHub scope
entries to worktrees, and resolves local-path entries to `ticket.scope`. The
three production deps wired in `tick.ts` are `readIntakeOutput`,
`cloneRemoteRepo`, and `stat`.

Three utility functions exported from `src/worktree.ts`:

- `parseIntakeScope(content)` — extracts the YAML `scope:` list from the
  `## Proposed Scope` section of an intake output file.
- `resolveGitHubSlug(entry)` — returns `org/repo` for a GitHub slug or URL
  entry, `null` for local paths or invalid entries.
- `cloneRemoteRepo(slug, token)` — clones to `~/.lazyboy/repositories/org/repo`
  and returns the path; returns the existing path if already present.

## Per-phase model configuration

Each phase is run with a model and thinking level resolved in this order:

1. `ticket.phases?.[phase]?.model` / `ticket.phases?.[phase]?.thinking` from
   `TicketState` frontmatter — set by the plan agent for the `implementation`
   phase; available for any phase key.
2. `config.phases?.defaults?.[phase]?.model` / `.thinking` from `config.toml`.
3. Hardcoded defaults in `PHASE_MODEL_DEFAULTS` (exported from `src/tick.ts`).

Model and thinking are resolved independently. The resolution function is
`resolvePhaseModel(config, phase, ticket)` exported from `src/tick.ts`. The
`TickDeps.resolveModelConfig` injectable wraps it for `advancePhase`.

To override the model for a phase globally, add to `config.toml`:

```toml
[phases.defaults.intake]
model = "claude-haiku-4-5"
thinking = "off"
```

The `thinking` field accepts the named levels `pi --thinking` accepts: `off`,
`minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

## `wont-do` phase

`wont-do` is a terminal phase (alongside `merge/done`) that permanently excludes
a ticket from the tick queue. The only valid status for `wont-do` tickets is
`"done"`.

- `wont-do` is **not** in `PHASE_SEQUENCE` or `ActivePhase` — it is never run as
  an agent phase.
- `wont-do` is in `FULL_PHASE_SEQUENCE` (after `merge`) so it sorts last in
  `lazyboy status` output and passes the `indexOf` cast in `status.ts`.
- The tick advance pass explicitly filters `t.phase !== "wont-do"` so future
  status expansions cannot accidentally re-admit these tickets.
- Use `lazyboy decline <id> [reason]` to set a ticket to `wont-do/done`. The
  optional reason is appended to the body as `\n\n---\nDeclined: <reason>`. The
  upstream provider ticket is **not** closed.
