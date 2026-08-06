# Agent Instructions

This file provides guidance to coding agents (Claude Code, Pi, etc.) working in
this repository.

## Non-Deno dependencies

These must be present on the host; they are not managed by Deno.

| Dependency                    | Purpose                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git`                         | Worktree management, rebase/push, state repo commits                                                                                                             |
| `pi`                          | Runs phase prompts; checks/installs agent packages                                                                                                               |
| `crontab`                     | Installs and removes the tick cron job                                                                                                                           |
| GitHub API (`api.github.com`) | Fetches assigned issues; checks PR merge status                                                                                                                  |
| `apfel`                       | Runs local LLM server for approval classification in review mode; also generates short titles at ticket ingestion (optional; skipped when absent or unavailable) |
| `git-worktreeinclude`         | Copies declared files from main checkout into new worktrees                                                                                                      |

Runtime env vars (tick only): `ANTHROPIC_API_KEY`, plus either
`GITHUB_TOKEN`/`GITHUB_LOGIN` (single-account) or the `token_env` vars named in
`[github.accounts.*]` (multi-account — see `resolveGitHubAccount` in
`src/compose.ts`). `JIRA_EMAIL`/`JIRA_API_TOKEN` are read directly from the env.
Config is read from `~/.config/lazyboy/config.toml`.

## Commands

```bash
deno task test                          # run all tests
LAZYBOY_DIR=$(mktemp -d) deno test --allow-all src/foo_test.ts  # single file
deno task start tick                    # run the tick loop once
deno run --allow-all src/index.ts status

notion-fetch page <url>           # fetch a Notion page as Markdown (requires NOTION_TOKEN)
notion-fetch database <url>       # fetch a Notion database as a Markdown table
notion-fetch search <query>       # search the Notion workspace
notion-fetch create <parent-url> <title>  # create a child Notion page (prints new URL)
notion-fetch append <page-url>            # append Markdown from stdin to a Notion page
```

Every new subcommand must have a 3-character zsh alias (`l` + first two unique
letters of the subcommand name) in `plugin/lazyboy.plugin.zsh` and a matching
row in the `README.md` alias table. Add a `compdef <alias>=lazyboy` line only if
the subcommand takes a ticket ID argument.

## Architecture

lazyboy is a cron-driven pipeline. `TickService` (`src/tick.ts`) owns the tick
workflow: acquire lock → install packages → fetch work → migrate → action pass →
advance pass → commit.

- `composeTickDeps` (`src/compose.ts`) is the single site where concrete
  adapters are constructed. No adapter construction happens inside
  `TickService`, and no other module reads adapter credentials from `Deno.env`.
- `advancePhase` is pure except for its injected `TickDeps` — keep it that way
  for testability.
- `spawnPhase` (`src/executor.ts`) runs each phase as a detached subprocess; the
  next tick detects completion via `isPhaseAlive(ticketDir)`. `run.pid` is
  gitignored at the state-repo root and never committed.
- The state dir is a separate git repo (`~/code/jackjennings/projects` by
  default). Each ticket is a directory in it; `meta.md` holds YAML frontmatter
  (via `gray-matter`) and phase output files (`intake.md`, …) live alongside.
  `commitState` runs `git add -A && git commit` there after each tick.

## Phase state machine

Tickets carry `phase: TicketPhase` and `status: TicketStatus`.

- `PHASE_SEQUENCE` covers only the five runner phases (`intake` →
  `implementation`), cycling `new → running → waiting → (approved) → running`;
  `merge` is handled explicitly in `advancePhase`.
- Implementation agents leave the ticket in `implementation/waiting` for review;
  once approved it moves to `merge/waiting`.
- Any phase can transition to `needs-attention` on subprocess failure.
- `{ phase: "merge", status: "done" }` is the terminal state.

When a phase agent exits without creating its output file
(`phase-output-invalid: missing`), `advancePhase` attempts one recovery before
transitioning to `needs-attention`: it reads `log.ndjson` for the last
`phase-end` entry whose `phase` matches the current phase, resumes that session
with a corrective prompt, and writes `outputRetries: 1` on `TicketState`. On the
next tick, if the file is now present, `outputRetries` is cleared to `undefined`
when the ticket is written to `waiting`. If the file is still absent, the ticket
transitions to `needs-attention` as normal. Recovery is skipped when
`readTicketLog` is absent from `TickDeps` (unit-test degradation path).

## Approval log

`TicketState.approvals` is an `ApprovalEntry[]` (`src/state/types.ts`); each
entry records `timestamp`, `actor` (`"human"`/`"agent"`/`"unknown"`), and
`phase`. `isApproved` gates advancement: `true` iff the last entry's `phase`
matches `ticket.phase`. Human approvals come from `performApprove`
(`src/commands/approve.ts`); agent approvals are appended by `advancePhase`
after a successful self-review. There is no single boolean `approved` field — do
not add one.

## Usage sidecar files

Each phase run writes `<timestampedPhase>.usage.json` alongside the phase output
`.md`, holding the fields of the `PhaseUsage` type (`src/state/types.ts`).
Non-obvious rules:

- Optional fields (`costUsd`, `tools`, …) are omitted when absent — never
  written as `null` or `{}`; `reasoning` tokens are excluded.
- The file is written only when the agent exits with a complete `agent_end`
  event.
- Directory scanners (e.g. `lazyboy status`) identify these by the `.usage.json`
  suffix.

## Phase prompts

One template per phase in `src/phases/prompts/*.md`, loaded by
`src/phases/runners.ts`. Prompt filenames must match the `ActivePhase` values in
`src/phases/types.ts` (`intake`, `enrichment`, `spec`, `plan`,
`implementation`). Prompt files may contain `{{partial-name}}` markers (double
curly braces, kebab-case, no spaces); each is replaced with the contents of
`src/phases/prompts/partials/<partial-name>.md` at load time. State-dir prompts
may use the same markers — partials always resolve from the built-in
`src/phases/prompts/partials/` directory, never from the state dir.

Do not write `_test.ts` files for prompt `.md` files. Prompt content is plain
text with no executable logic to test.

`advancePhase` appends up to three optional supplements (in order) when present,
each loader returning `""` when absent so no code change is needed to add one:

- **Provider** (`<provider>-<phase>.md`, via `loadProviderPrompt`). Supplement
  files must not contain `gh pr create` — the implementation-revision path
  reuses the same supplement and handles PR creation differently. Currently only
  `github-implementation.md` exists.
- **Artifact** (`<artifact>-<phase>.md`, via `loadArtifactPrompt`). Loaded after
  the provider supplement. Currently only `notion-{spec,plan,implementation}.md`
  exist.
- **State dir** (`{stateDir}/prompts/{phase}.md`, via `loadStatePrompt`),
  appended last. For `implementation` the same file applies to both the normal
  and revision runs.
- **Self-review** — see below.

The state-dir prompts directory lives at the state-repo root, not inside a
ticket directory:

```
{stateDir}/
  prompts/{intake,enrichment,spec,plan,implementation}.md
  {ticket.id}/…
```

## Self-review

`selfReview` (`src/self-review.ts`) is the only module that reads
`*-self-review.md` prompts and makes automated-approval calls — do not add
automated-approval calls anywhere else. When a prompt is present for a phase, an
`APPROVE` response makes `advancePhase` append an `ApprovalEntry` with
`actor: "agent"`; when absent, the ticket waits for human approval. To add
support for a phase, create `src/phases/prompts/<phase>-self-review.md`
instructing the model to answer exactly `APPROVE` or `REJECT` — no code change.
Prompts currently exist for `intake`, `enrichment`, `spec`.

## Principles file

Opt-out via `[tick] principles` in `config.toml` (default `true`). When `false`,
`composeTickDeps` makes `appendPrinciples` a no-op and passes
`includePrinciples: false` so `buildContextFiles` skips `@principles.md`.

`{stateDir}/principles.md` is a scratchpad accumulated across tickets.
`buildContextFiles` (`src/run-phase.ts`) prepends `@principles.md` to every
phase's context when the file exists. When a phase output contains a
`## Principles` section, `advancePhase` extracts it, dedupes against the
existing file, and — if novel — appends and commits `principles.md` alone via
`commitPrinciples`. The parsing and dedup logic (`extractPrinciples`,
`dedupePrinciples`) lives in `src/run-phase.ts`.

## Runtime dir (`lazyboyDir`)

Anything that writes under the runtime dir — the combined `log.ndjson`,
`tick.ndjson`, and future logging — must resolve its base path via
`lazyboyDir()` (`src/paths.ts`), never `join(HOME, ".lazyboy", …)` inline. It
returns `$LAZYBOY_DIR` when set, else `$HOME/.lazyboy`. This is the single seam
that keeps tests from writing to the operator's real `~/.lazyboy`:
`deno task
test` sets `LAZYBOY_DIR=$(mktemp -d)`, so any code routed through
`lazyboyDir()` is isolated automatically with no per-test setup. Single-file
runs must set it too (see Commands). A test that inspects the combined/tick log
directly uses `withLazyboyDir()` (`src/test-support.ts`) for its own scratch
dir.

Non-log paths (`worktrees/`, `pi/`, `claude-code/`, `anthropic-pricing.json`,
`tick.pid`, `last-worked.json`) still read `HOME`/`opts.homeDir` directly; their
tests isolate via `HOME`. Do not route them through `lazyboyDir()` — it would
defeat that per-test `HOME` isolation.

## `tick.ndjson` format

`~/.lazyboy/tick.ndjson` is NDJSON — one object per line with `ts` (ISO 8601
UTC) and `event`. Events: `tick-already-running`, `stale-lock`, `lock-failed`,
`tick-failed`. `appendTickLog` (`src/tick.ts`) writes it directly; it is not
`appendTicketLog` (`src/state/store.ts`).

The cron line from `cronLine()` must **not** redirect stdout/stderr to
`tick.ndjson` — the tick process owns its own writes. Do not add
`>> … tick.ndjson 2>&1`.

## Per-ticket `log.ndjson` format

`<stateDir>/<ticket.id>/log.ndjson` is the per-ticket event log (distinct from
the runtime `tick.ndjson` above). Every entry is written by `appendTicketLog`
(`src/state/store.ts`) — do not append to it inline elsewhere — and carries a
`ts` (ISO 8601 UTC), an `event`, and event-specific fields. Reuse an existing
event rather than coining a synonym:

| `event`                                                                            | Written by / meaning                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `ticket-captured`                                                                  | A new ticket was written for the first time; carries `title`. |
| `phase-start` / `phase-end`                                                        | A phase subprocess is spawned / completes.                    |
| `phase-transition`                                                                 | `phase` changes.                                              |
| `status-transition`                                                                | `status` changes.                                             |
| `needs-attention`                                                                  | Ticket parked for a human; carries a `reason`.                |
| `phase-output-invalid`                                                             | Agent produced no/invalid output; carries a `reason`.         |
| `phase-output-retry`                                                               | Recovery resume attempted after invalid output.               |
| `self-approved`                                                                    | Self-review appended an agent `ApprovalEntry`.                |
| `conflict-resolution-started` / `conflict-resolution-failed` / `conflict-resolved` | Conflict-resolution lifecycle.                                |
| `branch-pushed`                                                                    | A worktree branch was successfully force-pushed to origin.    |
| `ci-triage-resolved`                                                               | A CI-triage run's verdict was applied.                        |
| `worktree-include-failed`                                                          | `git-worktreeinclude` copy failed (non-fatal).                |
| `error`                                                                            | An action or phase threw; carries the error message.          |

A `reason` field, where present, is a lowercase kebab-case label naming the
cause (`agent-failed`, `output-file-missing`, `empty`, `no-prs`, `no-worktrees`,
`no-github-repos`, `github-slug-extraction-failed`, `clone-failed`,
`worktree-creation-failed`, `push-failed`, `no-verdict-line`). Reuse an existing
label when it fits; add a new one only for a genuinely new cause, and never put
free prose in `reason` (that belongs in a separate field or the `error`
message). Work-item identity is the ticket directory itself — do not add an `id`
or `ticketId` field to per-ticket entries.

## Failure handling

The default response to a failure is decided by where it happens, not per-caller
— do not re-derive this for each new action:

- **Phase subprocess failure or invalid output** → `needs-attention`, with a
  `reason`. This is the only path that parks a ticket for a human (see the phase
  state machine and the one-shot output recovery above).
- **`TickAction` side-effect failure** (push, rebase, worktree cleanup, closing
  the upstream issue, notification) → log it to `log.ndjson` and continue;
  **never block the state machine or throw out of the action.** An action may
  set `needs-attention` only when the failure means the ticket genuinely cannot
  proceed — and then its `applies` must exclude `status === "needs-attention"`
  to avoid a retry loop.
- **Background analysis subprocess** → fire-and-forget; its failure must never
  touch ticket state (see Background analysis subprocesses).

New per-tick behavior that mutates `TicketState` belongs in a `TickAction`, not
inline in `advancePhase`; keep `advancePhase` to phase/status transitions and
their recovery. Inline logic in `advancePhase` is reserved for the state-machine
transitions themselves.

## Dependency injection

Modules expose `*Deps` interfaces for testing (`TickDeps`, `TickServiceDeps`,
`InstallDeps`, `PidFileLockDeps`). Keep the surface minimal — inject only what
tests substitute. `TickServiceDeps` is the full surface of `TickService`; tests
satisfy it with plain object literals, touching no filesystem, git, or network.

Production helpers that satisfy a `*Deps` interface live in the same module as
the interface and are named tool-agnostically (e.g. `isPackageInstalled` in
`src/packages.ts` — that it shells to `pi` is not part of the name).

`PidFileLockDeps` (`{ log, isPidAlive? }`, `src/lock.ts`) is the deliberate
exception: `PidFileLock` must have zero knowledge of `tick.ndjson` or any
tick-specific concept, so its `log` implementation (`appendTickLog`) lives in
`src/tick.ts` and `composeTickDeps` wires the two together.

Command functions that internally call `commitTicket` (`performApprove`,
`performRetry`) accept an optional `commitFn` parameter (defaulting to
`commitTicket`). `performDecline` accepts multiple injected functions and takes
them as a single deps object (`{ commitFn?, killFn? }`). When a command function
needs more than one injected dependency, use a deps object rather than
positional parameters. Tests pass a `spy(() => Promise.resolve())` from
`@std/testing/mock` to avoid a real git repo. Do not use `setupGitStateDir` or
real git processes in tests for these three commands.

## CodeAgent adapters

Phase runtimes implement `CodeAgent` (`src/agents/types.ts`). Two adapters
exist: `PiCodeAgent` (`src/agents/pi.ts`, shells to `pi`) and `ClaudeCodeAgent`
(`src/agents/claude-code.ts`, shells to `claude`). The `pi` CLI must not be
referenced by name outside `pi.ts`; the `claude` CLI must not be invoked via
`Deno.Command` outside `claude-code.ts`. Ancillary helper functions
(`judgePrinciples`, `selfReview`, `applyLearning`, `callLlm`) that shell to
`claude` via an injected `CommandRunner` are exempt from this restriction. New
CodeAgent adapters go in `src/agents/<name>.ts` and implement `CodeAgent`.

- `[agent].type` (default `"pi"`) selects the adapter, orthogonal to
  `[pi].provider` (which applies only when `agent.type === "pi"`). Resolved once
  in `composeTickDeps` and threaded through `ExecutorOptions.agent`.
- Arg-builders (`buildPiArgs`, `buildClaudeCodeArgs`) take a single named-key
  options object, not positional params. New adapters follow the same style.
- `ClaudeCodeAgent` is Anthropic-direct only (ignores `provider`) and maps
  `thinking` to `--effort` (`off`/`minimal` omit the flag). It has no `@file`
  mechanism — `contextFiles` are listed in the prompt text and their parent dirs
  passed via `--add-dir`. It always passes `--setting-sources project,local`
  (otherwise a nested `claude` loads the operator's personal
  hooks/skills/plugins/MCP into the phase) and `--verbose` (required with
  `--print` + `--output-format stream-json`).

### Bedrock support

`[pi] provider = "bedrock"` runs every phase through `pi --provider bedrock`.
Two things are the user's responsibility, not lazyboy's: model IDs in
`config.toml` must already carry the Bedrock `anthropic.` prefix (lazyboy does
not rewrite model strings), and `AWS_REGION` plus AWS credentials must be
present in the environment (`executePhase` spreads `Deno.env.toObject()` into
the subprocess). `PHASE_MODEL_DEFAULTS` is unprefixed, so Bedrock users must
override every phase in `[phases.defaults]`, including `"conflict-resolution"`.

## Per-phase model configuration

Model and thinking are resolved independently, in order, by
`resolvePhaseModel(config, phase, ticket)` (`src/tick.ts`; wrapped by
`TickDeps.resolveModelConfig`):

1. `ticket.phases?.[phase]?.{model,thinking}` frontmatter (set by the plan agent
   for `implementation`; available for any phase).
2. `config.phases?.defaults?.[phase]?.{model,thinking}`.
3. `PHASE_MODEL_DEFAULTS` (exported from `src/tick.ts`).

```toml
[phases.defaults.intake]
model = "claude-haiku-4-5"
thinking = "off"
```

`thinking` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

Ancillary (non-phase) LLM calls — approval classification (`src/review.ts`),
self-review (`src/self-review.ts`), the review Q&A overlay, short-title
generation — are **not** routed through `resolvePhaseModel` and are not
per-phase configurable. They pin their model at the call site: cheap
classification and validation use `claude-haiku-4-5`; a call that must reason
over a diff (e.g. `apply-learning.ts`) uses `claude-sonnet-4-6`. A new ancillary
call follows this split rather than adding a config knob.

## Tick actions

Per-tick behaviors are `TickAction` implementations in `src/tick-actions/`. Each
exports a `*Deps` interface, a factory, and a `*_test.ts` (pattern:
`check-merged-pr.ts`). Register them in `src/compose.ts` (not `src/tick.ts` —
`TickService` receives them via `TickServiceDeps`).

- An action's `applies` predicate must exclude tickets where a phase agent is
  live (`isPhaseAlive(ticketDir)` true) — rebasing or pushing under a live agent
  corrupts its git state. Actions that can set `needs-attention` must also
  exclude `status === "needs-attention"` to avoid a retry loop.
- `TicketState.ciHandledRunIds?: string[]` records check-suite IDs
  `spawnCITriageAction` has already triaged (append-only; never removed). Use it
  only for CI-failure dedup.
- `spawnCITriageAction` is opt-out via `[tick] resolve_ci_failures` (default
  `true`); when `false`, `composeTickDeps` omits it.

## Background analysis subprocesses

Non-phase background agents run alongside a ticket's phase agent without
participating in the state machine. The tick loop tracks liveness only via
`run.pid`, so a subprocess must write a **distinct** PID file to stay invisible
to ticket state (see `spawnOutlierAnalysis` in `TickDeps` for the existing
example).

To add one:

- Give it a distinct `pidFile` name (not `run.pid`).
- Add an optional method to `TickDeps`; guard the call in `advancePhase` with
  `?.`.
- Wire it in `composeTickDeps`.
- Never write `ticket.status` or `ticket.phase` from the subprocess.

## PR tracking

`TicketState.prs?: PrEntry[]` (`src/state/types.ts`) tracks pull requests. Each
`PrEntry` carries `url`, `title`, `dependsOn` (PR URLs that must merge first),
`merged`, and `worktreeKey`. `checkMergedPRAction` checks each PR only once all
its `dependsOn` are `merged: true`, cleans up the worktree on merge, and reaches
`done` only when every entry is merged. Do not introduce a `prUrl` field or any
other single-PR field.

## `runGit` in `src/worktree.ts`

`runGit` is the shared git-shelling helper (returns `{ code, stdout, stderr }`),
exported so `TickAction`s can inject it and test against a stub. Do not
introduce a second git-shelling helper — use or inject `runGit`.

## Conflict resolution

On a rebase conflict, `checkConflictsAction` writes a
`${timestamp}-conflict-context-<branch>.md` sentinel and spawns a
conflict-resolution agent (phase name `"conflict-resolution"`, same per-phase
model resolution as runner phases, defaulting to `claude-opus-4-7`/`high`). The
context and output (`${timestamp}-conflict-resolution.md`) files share the
timestamp. The agent receives only `@meta.md` and the context file; the worktree
is left mid-rebase.

`resolveConflictsAction` detects finished runs by a `*-conflict-context-*.md`
suffix match when the PID dies, and must be registered **before**
`checkConflictsAction` so a just-finished resolution is handled before the
conflict check can re-fire.

To spawn with a non-default model or explicit context files, set `model` /
`contextFiles` on `ExecutorOptions`; `run-phase.ts` reads `--model` (default
`claude-sonnet-4-6`) and `--context-files` (comma-separated `@file`; omit to use
`buildContextFiles`). Do not hardcode the model elsewhere.

## Migrations

Migration data files live at
`migrations/<UNIX_TIMESTAMP_SECONDS>-<kebab-slug>.ts` (root-level, sibling to
`src/`), each with a companion `<timestamp>-<slug>_test.ts` that tests
`migration.run()` against a real temp directory. The runner (`src/migrations/`)
filters `/^\d+-[a-z0-9-]+\.ts$/` and sorts lexicographically; the numeric prefix
is the ordering and identity key. Applied IDs are recorded globally in
`<stateDir>/.migrations` (one per line); there is no per-ticket log and no
rollback.

Two migration interfaces exist in `src/migrations/types.ts`:

- **`Migration`** — `run(ticket, stateDir)`: per-ticket; receives one
  `TicketState` and returns an updated one. No `type` field required.
- **`StoreMigration`** — `type: "store"; run(stateDir)`: whole-store; receives
  only the stateDir path and returns `void`. Use when the change cannot be
  scoped to a single ticket directory.

The runner dispatches on `migration.type === "store"` after loading each file. A
per-ticket migration that changes `ticket.id` must **move** the on-disk
directory with `Deno.rename` (creating the parent via
`Deno.mkdir(..., { recursive: true })` first), never `Deno.remove` — the runner
only writes `meta.md` back, so every other file (`log.ndjson`, phase outputs,
`.usage.json`) survives only because the migration moved it. Its test must
assert file contents exist at the new path, not merely that the old directory is
gone (a prior migration destroyed history because its test only checked the
latter).

## Per-org GitHub credentials

`resolveGitHubAccount(org, config)` (`src/compose.ts`) is the single mapping
from org slug to `{ token, login }`:

- `config.github.accounts` absent → `GITHUB_TOKEN`/`GITHUB_LOGIN` from the env.
- present and org in `config.github.orgs` → token from `account.tokenEnv` plus
  the configured `login`.
- present but org unmapped → falls back to `GITHUB_TOKEN`/`GITHUB_LOGIN`.

`GitHubProvider` takes `accountResolver: (org) => { token, login }`, not a
single token/login. `spawnPhase` sets both `GITHUB_TOKEN` and `GH_TOKEN` so the
`gh` CLI (which prefers `GH_TOKEN`) uses the right account. `loadConfig`
validates at startup that every `token_env` is set and every `[github.orgs]`
entry names a known account.

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

## Ticket ID format

IDs are POSIX relative paths (`join(stateDir, id, …)` resolves them); the
slashes create the namespaced directory structure under `stateDir`.

- **GitHub**: `github/<org>/<repo>/<issue-number>` (e.g.
  `github/jackjennings/lazyboy/23`).
- **Jira**: `jira/<issue-key>` (e.g. `jira/PROJ-123`; keys are globally unique
  per instance).

Do not introduce ID formats that omit the provider prefix or use a flat
single-segment string.

## Shell completion

`src/completion.zsh` is a static, generic dispatcher — it does **not** hardcode
command names, flags, or IDs. It reads `lazyboy _completions` (name,
description, and `completesWith` per command) and `lazyboy _ids` at runtime. So
a new command or flag becomes completable by declaring its metadata on the
`Command` (set `completesWith: "_ids"` for a command that takes a ticket ID, or
a comma-separated literal list for fixed choices) — **do not edit
`completion.zsh`** for a new command, flag, status value, or phase.

## `codebase.roots` semantics

Entries must be base code directories (e.g. `~/code`), not org-scoped
(`~/code/myorg`). `findLocalRepo` searches exactly two levels deep:
`root/<org>/<repo>`. Config examples and fixtures must use org-less paths.

## Remote repository cache

When a scope entry is a GitHub slug/URL with no local checkout,
`cloneRemoteRepo` (`src/worktree.ts`) clones to
`~/.lazyboy/repositories/<org>/<repo>`, delegating the `gh repo clone`
subprocess to `GitHubProvider.clone`, which forwards only `PATH`, `HOME`, and
`GH_TOKEN`. Existing clones are reused — no `git fetch` or `git pull` is ever
run on them (they are persistent snapshots). `createWorktreeAction` fires at
`phase === "intake" && status === "waiting" && isApproved(ticket)`.

## Imports

Use the project's import conventions from `deno.json`. For test assertions, use
`@std/assert` (bare specifier) — not `jsr:@std/assert` or
`https://deno.land/std@...` URLs.

Reach for the most specific `@std/assert` assertion the check allows; a bare
`assertEquals` against a boolean, comparison, or containment hides intent and
produces a worse diff on failure. Match the assertion to the check — booleans
(`assert`/`assertFalse`), presence (`assertExists`), substring/element
membership (`assertStringIncludes`/`assertArrayIncludes`), ordering
(`assertGreater`/`assertLess`), errors (`assertRejects`/`assertThrows`), etc.
Reserve `assertEquals` for genuine value equality. Do not fold a comparison or
containment into a boolean just to `assertEquals(..., true)`.

For test doubles (spies, stubs), use `spy` and `stub` from `@std/testing/mock`
(bare specifier). Do not write hand-rolled stub functions for the same purpose.
Access recorded calls via `spy.calls` and assert call counts with
`assertSpyCalls`.

CLI format functions (`formatGlobalHelp`, `formatCommandHelp`) live in
`src/commands/help.ts` and are pure — no `Deno.args`, no `console.log`, no
`Deno.exit`. Tests that assert on `--help` output import these functions
directly. Tests that assert on `Deno.exit` behavior use subprocess via
`runIndex`. Do not add `Deno.args`, `console.log`, or `Deno.exit` to `help.ts`.

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

Do not abbreviate words in identifiers, names, or user-visible strings. Write
`DocumentationGapsCeremony`, not `DocGapsCeremony`;
`"Documentation gaps ready"`, not `"Doc gaps ready"`.

Functions with more than three parameters, or parameters whose positional
ordering is non-obvious, take a single named-key options object rather than
positional params.

## Formatting

Run `deno fmt` and `deno lint` after writing all files and before committing,
including when the only files changed are Markdown (`.md`). `deno fmt` formats
Markdown as well as source — do not skip it just because no `.ts` files changed.
Do not manually adjust indentation or spacing — let the formatter handle it.

## Commits

All commits to the lazyboy source repo must use
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format:
`<type>[(<scope>)][!]: <description>`

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, `revert`

`chore` is for changes that produce no functional change to the lazyboy
executable (e.g. updating `.gitignore`); when any more specific type applies,
use it instead.

Description rules: imperative mood, lowercase after the colon, no trailing
period, ≤72 characters on the subject line.

Scope is optional; use it when it meaningfully narrows the context (e.g.
`fix(tick): …`).

`git revert`-generated subjects (`Revert "…"`) are exempt from the format. When
manually authoring a revert commit, use `revert: …`.

`scripts/commit-lint.sh` enforces this format and can be symlinked as
`.git/hooks/commit-msg` for local enforcement. CI validates all commits on pull
requests and direct pushes to main.

## Planning

Every task in a plan must produce a code change and a commit. Do not create
tasks that only run verification commands without making changes.

## CI triage

When `spawnCITriageAction` encounters any CI failure (`failure` or
`action_required` conclusion) on an unmerged PR, it writes a context file and
spawns a triage agent to classify the failure. There is no deterministic pattern
matching on the failing step and no direct fmt/lint auto-fixing — every failure
goes through the triage agent. This is an async two-tick pattern identical in
structure to conflict resolution.

**Tick 1 (spawn):** `spawnCITriageAction` writes
`${timestamp}-ci-triage-context-${runId}.md` to the ticket directory containing
the PR URL, repo, run ID, branch, worktree path, CI output, and PR diff (with
patches). It calls `spawnPhase` with the context file, marks the run ID in
`ciHandledRunIds`, writes the ticket, and returns. If `writeContextFile` or
`spawn` throws, the run ID is removed from `ciHandledRunIds` and processing
continues to the next PR.

**Tick 2 (resolve):** `resolveCITriageAction` detects completed triage runs by
checking for `*-ci-triage-context-*.md` files when no live process is present.
For each context file it derives the output filename by replacing
`-ci-triage-context-` with `-ci-triage-` (the same timestamp prefix is shared).
It parses the verdict from the first line matching
`/^VERDICT:\s*(PR_CAUSED|INFRA)/im`. A `PR_CAUSED` verdict creates a GitHub
issue; an `INFRA` verdict creates no issue (the failure has no PR-side cause) —
it is only logged. Both the context and output files are deleted after
resolution.

**Phase key:** `"ci-triage"` in `PHASE_MODEL_DEFAULTS` (`src/tick.ts`). Default:
`{ model: "claude-sonnet-4-6", thinking: "high" }`. Override via `config.toml`
`[phases.defaults.ci-triage]` or `ticket.phases["ci-triage"]`. Bedrock users
must override this phase the same way as `"conflict-resolution"`.

**Agent prompt:** instructs the agent to default to `PR_CAUSED` unless there is
positive evidence of infrastructure failure (network errors, rate limits, runner
timeouts, package download failures, transient flakiness). The last line of the
agent's output must be exactly `VERDICT: PR_CAUSED` or `VERDICT: INFRA`.

`resolveCITriageAction` must be registered **before** `spawnCITriageAction` in
the `tickActions` array so a completed triage run is resolved before the spawn
action can re-evaluate the same ticket. Both are gated on
`config.tick.resolveCIFailures`.

## `wont-do` phase

Terminal phase (alongside `merge/done`) that permanently excludes a ticket from
the tick queue; its only valid status is `"done"`.

- Not in `PHASE_SEQUENCE` or `ActivePhase` — never run as an agent phase.
- In `FULL_PHASE_SEQUENCE` (after `merge`) so it sorts last in `lazyboy status`.
- The advance pass filters `t.phase !== "wont-do"` so status expansions cannot
  re-admit it.
- `lazyboy decline <id> [reason]` sets `wont-do/done` and appends
  `\n\n---\nDeclined: <reason>` to the body; the upstream provider ticket is
  **not** closed.
