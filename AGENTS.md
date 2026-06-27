# Agent Instructions

This file provides guidance to coding agents (Claude Code, Pi, etc.) working in
this repository.

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

**Phase state machine**: tickets move through
`new → running-intake → waiting-intake → running-enrichment → … → waiting-diff → waiting-merge → done`.
Any phase can transition to `needs-attention` on non-zero subprocess exit. The
implementation phase is special: `running-implementation` transitions to
`waiting-diff` (not `waiting-implementation`).

**Executor** (`src/executor.ts`): `spawnPhase()` launches `src/run-phase.ts` as
a detached Deno subprocess. The subprocess runs
`pi -p "<prompt>" @/ticket/meta.md` with the ticket directory (or worktree path
during implementation) as `cwd`, writes stdout to the phase output file, then
exits. The tick detects completion by checking PID liveness on the next run.

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
- Phase names are the single source of truth in `PHASE_SEQUENCE`
  (`src/phases/types.ts`). The Phase union type in `src/state/types.ts` must
  stay in sync with it manually.
- `waiting-diff` is not derived from `running-implementation` by the normal
  `running-X → waiting-X` pattern — it's a hardcoded special case in
  `runningPhaseToWaiting`.
- The state dir is a separate git repo (`~/code/jackjennings/projects` by
  default). `commitState` runs `git add -A && git commit` inside it after each
  tick.

## Dependency injection

Several modules expose a `*Deps` interface for testing (`TickDeps`,
`InstallDeps`, `TickOrchestrationDeps`). Keep the surface minimal — only inject
what tests actually need to substitute.

Production helpers that satisfy a `*Deps` interface live in the same module as
the interface and are named tool-agnostically. `isPackageInstalled` belongs next
to `InstallDeps` in `src/packages.ts`; the fact that it shells out to `pi` is an
implementation detail, not part of the name.

## Imports

Use the project's import conventions from `deno.json`. For test assertions, use
`@std/assert` (bare specifier) — not `jsr:@std/assert` or `https://deno.land/std@...` URLs.

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
