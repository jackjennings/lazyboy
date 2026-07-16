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

Run `deno fmt` and `deno lint` after writing all files and before committing. Do
not manually adjust indentation or spacing — let the formatter handle it.

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
