# Agent Instructions

This file provides guidance to coding agents (Claude Code, Pi, etc.) working in
this repository.

## Non-Deno dependencies

These must be present on the host; they are not managed by Deno.

| Dependency                    | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `git`                         | Worktree management, rebase/push, state repo commits |
| `pi`                          | Runs phase prompts; checks/installs agent packages   |
| `crontab`                     | Installs and removes the tick cron job               |
| GitHub API (`api.github.com`) | Fetches assigned issues; checks PR merge status      |

Environment variables required at runtime (tick only): `GITHUB_TOKEN`,
`GITHUB_LOGIN`, `ANTHROPIC_API_KEY`.

## Commands

```bash
deno task test                          # run all tests
deno test --allow-all src/foo_test.ts  # run a single test file
deno task start tick                    # run the tick loop once
deno run --allow-all src/index.ts status
```

Runtime env vars required for `tick`: `GITHUB_TOKEN`, `GITHUB_LOGIN`,
`ANTHROPIC_API_KEY`. Config is read from `~/.config/lazyboy/config.toml`.

## Architecture

lazyboy is a cron-driven autonomous pipeline. `bin/lazyboy` → `src/index.ts`
dispatches to three subcommands: `tick`, `approve`, `status` (plus
`enable`/`disable` for cron management via `src/cron.ts`).

**Tick loop** (`src/tick.ts`): acquires a PID lock at `~/.lazyboy/tick.pid`,
fetches new GitHub Issues via `src/providers/github.ts`, then calls
`advancePhase()` for each active ticket. `advancePhase` is dependency-injected
(`TickDeps`) to keep it unit-testable without real filesystem or process access.

**Phase state machine**: tickets carry two fields — `phase: TicketPhase` and
`status: TicketStatus`. Status transitions are
`new → running → waiting → (approved) → running` cycling through phases in
`PHASE_SEQUENCE`. When an `implementation` agent exits, the ticket stays in
`implementation/waiting` for review. Once approved, it transitions to
`merge/waiting`. `PHASE_SEQUENCE` covers only the five runner phases (`intake`
through `implementation`); `merge` is handled explicitly in `advancePhase`. Any
phase can transition to `needs-attention` on subprocess failure.
`{ phase: "merge", status: "done" }` is the terminal state.

**Executor** (`src/executor.ts`): `spawnPhase()` launches `src/run-phase.ts` as
a detached Deno subprocess. The subprocess runs
`pi --mode json --approve "<prompt>" @/ticket/meta.md` with the ticket directory
(or worktree path during implementation) as `cwd`. Stdout is NDJSON;
`extractUsageAndText` in `run-phase.ts` reconstructs the assistant text for the
phase output file and aggregates token usage. After the subprocess exits, two
files are written: the phase output `.md` and a sidecar
`<timestamped-phase>.usage.json` (omitted if no `agent_end` event was received).
The tick detects completion by checking PID liveness on the next run.

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
`APPROVE`, writes the ticket a second time with `approved: true`. When absent
for a phase, self-review is skipped and the ticket waits for human approval as
before. Currently only `intake` has a self-review prompt.

## Key constraints

- `advancePhase` is pure except for the injected `TickDeps` — keep it that way
  for testability.
- The state dir is a separate git repo (`~/code/jackjennings/projects` by
  default). `commitState` runs `git add -A && git commit` inside it after each
  tick.

## Usage sidecar files

Each phase run writes a `<timestampedPhase>.usage.json` file alongside the phase
output `.md` in the ticket directory. The file contains exactly the fields of
`PhaseUsage` (`input`, `output`, `cacheRead`, `cacheWrite`, `model`,
`durationMs`). Dollar amounts and `reasoning` tokens are excluded. Files are
written only when `pi` exits with a complete `agent_end` event. Code that scans
ticket directories (e.g. `lazyboy status`) identifies usage files by the
`.usage.json` suffix.

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

## `tick.ndjson` format

`~/.lazyboy/tick.ndjson` uses NDJSON format — one JSON object per line, each
with a `ts` field (ISO 8601 UTC) and an `event` field. The four events are:

- `tick-already-running` — another tick process holds the lock within the
  staleness threshold
- `stale-lock` — a live PID holds the lock beyond `STALE_LOCK_MS`
- `lock-failed` — `Deno.writeTextFile` for the PID file threw
- `tick-failed` — `advanceTickets` threw

The cron line generated by `cronLine()` must **not** redirect stdout/stderr to
`tick.ndjson`. The tick process owns its own writes. Do not add
`>> ... tick.ndjson 2>&1` back to the cron line.

The `appendTickLog` helper in `src/tick.ts` is unexported and writes directly to
this file; it is not the same as `appendTicketLog` in `src/state/store.ts`.

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
`InstallDeps`, `TickOrchestrationDeps`). Keep the surface minimal — only inject
what tests actually need to substitute.

Production helpers that satisfy a `*Deps` interface live in the same module as
the interface and are named tool-agnostically. `isPackageInstalled` belongs next
to `InstallDeps` in `src/packages.ts`; the fact that it shells out to `pi` is an
implementation detail, not part of the name.

## CodeAgent adapters

Code-agent runtimes (CLI tools or SDKs that execute phase prompts) implement the
`CodeAgent` interface from `src/agents/types.ts`. The sole production adapter is
`PiCodeAgent` in `src/agents/pi.ts`. The `pi` CLI must not be referenced by name
outside `src/agents/pi.ts`.

`runPhase` opts include `provider` and `model` — the adapter uses them in
subprocess args but does not define them. Model and provider selection belongs
to the call site: `run-phase.ts` defines `PI_PROVIDER` and `PI_MODEL` as
module-level constants and passes them through `executePhase`.

New adapters belong in `src/agents/<name>.ts` and must implement `CodeAgent`.
The `if (import.meta.main)` block in `run-phase.ts` is the only place that
constructs `PiCodeAgent`.

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
where `ticket.pid !== undefined && isPidAlive(ticket.pid)` — rebasing or pushing
while a live agent holds the worktree corrupts the agent's git state. Actions
that can transition a ticket to `needs-attention` must also exclude
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
`conflict-context-<branch>.md` sentinel file to the ticket directory and spawns
a conflict-resolution agent. The agent uses `--model claude-opus-4-7` and
receives only `@meta.md` and `@conflict-context-<branch>.md` as context (not the
full `buildContextFiles` set). The worktree is left in the mid-rebase state for
the agent to resolve.

`resolveConflictsAction` detects completed conflict-resolution runs by checking
for `conflict-context-*.md` in the ticket directory when a running ticket's PID
dies. It must be registered **before** `checkConflictsAction` in the
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
