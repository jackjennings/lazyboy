# lazyboy

Automates software development so human time is spent only on tasks requiring
judgement. Polls for assigned work, runs each ticket through a phase pipeline
via an AI agent, and pauses at each phase boundary for human approval.

## How it works

Each ticket moves through six phases:

| Phase              | What runs                                                      | Human gate      |
| ------------------ | -------------------------------------------------------------- | --------------- |
| **intake**         | Proposes which repos the ticket needs access to                | Approve scope   |
| **enrichment**     | Gathers context from the codebase                              | Review context  |
| **spec**           | Writes a precise specification                                 | Validate spec   |
| **plan**           | Writes a TDD implementation plan                               | Approve plan    |
| **implementation** | Writes the code                                                | Review diff     |
| **merge**          | Calls GitHub API to merge PR, removes worktree, deletes branch | Authorize merge |

Each phase runs [pi](https://pi.dev) as a host subprocess with `cwd` set to the
ticket directory or approved worktree, and the relevant context files passed in
as `@/path` arguments.

A cron job runs `lazyboy tick` every 5 minutes. Tickets advance automatically
until they hit a gate, then wait for `lazyboy approve <id>`.

## Usage

```bash
lazyboy tick           # advance all active tickets (run by cron)
lazyboy approve <id>   # approve the current phase gate
lazyboy status         # show all active tickets
lazyboy enable         # add cron job
lazyboy disable        # remove cron job
lazyboy completion zsh # print zsh completion script
```

### Zsh plugin

The `plugin/lazyboy.plugin.zsh` file defines 12 three-character aliases and
sources tab completions automatically. To install:

**Oh My Zsh:**

```zsh
git clone https://github.com/jackjennings/lazyboy \
  ~/.oh-my-zsh/custom/plugins/lazyboy
```

Then add `lazyboy` to the `plugins` array in `~/.zshrc`:

```zsh
plugins=(... lazyboy)
```

The plugin sources `lazyboy completion zsh` at shell startup, so no separate
completion setup is needed when using the plugin.

| Alias | Command              |
| ----- | -------------------- |
| `ltk` | `lazyboy tick`       |
| `lap` | `lazyboy approve`    |
| `lst` | `lazyboy status`     |
| `len` | `lazyboy enable`     |
| `ldi` | `lazyboy disable`    |
| `lco` | `lazyboy completion` |
| `lrt` | `lazyboy retry`      |
| `ldc` | `lazyboy decline`    |
| `lrv` | `lazyboy review`     |
| `lsh` | `lazyboy shell`      |
| `lta` | `lazyboy tail`       |
| `lup` | `lazyboy update`     |

### Shell completions

**Inline (`.zshrc`):**

```zsh
source <(lazyboy completion zsh)
```

**fpath drop-in:**

```zsh
lazyboy completion zsh > "${fpath[1]}/_lazyboy"
autoload -U compinit && compinit
```

Cron invokes `scripts/tick.sh`, which handles token capture and env setup. To
override env vars (e.g. `ANTHROPIC_API_KEY`), add them to
`~/.config/lazyboy/env`.

## State

Each ticket is a directory in `~/code/jackjennings/projects/<id>/`:

```
gh-42/
  meta.md        # phase, approved, artifact type, scope, title, url
  intake.md      # scope proposal
  enrichment.md  # codebase context
  spec.md        # specification
  plan.md        # implementation plan
  diff.md        # implementation diff summary
  log.md         # timestamped lifecycle log (appended by each phase)
```

Approval is as simple as opening `meta.md` and setting `approved: true`, or
running `lazyboy approve gh-42`.

## Config

`~/.config/lazyboy/config.toml`:

```toml
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2

[packages]
enabled = ["agent-browser"]

[codebase]
roots = ["~/code"]

[agent]
type = "pi"

[pi]
provider = "anthropic"

[todo_txt]
file = "~/todo.txt"
```

`[todo_txt]` adds a local [todo.txt](https://todotxt.org) file as a work
provider. Every non-completed task becomes a ticket. When a ticket closes, the
task is marked done in-place with an `x YYYY-MM-DD` prefix. The `file` key is
required when the section is present; `~/` is expanded to the home directory.

`[agent].type` selects which CLI runs every phase — `"pi"` (default) for the
`pi` CLI, or `"claude-code"` to run the `claude` CLI instead. This is orthogonal
to `[pi].provider` below, which only takes effect when `agent.type` is `"pi"`.

`[pi].provider` selects which backend `pi` talks to for every phase —
`"anthropic"` (default) for the direct Console API, or `"bedrock"` for Amazon
Bedrock. When using `"bedrock"`, model IDs configured under `[phases.defaults]`
must already carry Bedrock's `anthropic.` prefix (e.g.
`anthropic.claude-opus-4-8`, not `claude-opus-4-8`), and `AWS_REGION` plus AWS
credentials must be available in lazyboy's own environment (env vars, a shared
profile, or an instance role) — lazyboy does not manage AWS auth itself. Every
phase must be explicitly configured under `[phases.defaults]` when using Bedrock
— any phase left unconfigured falls back to lazyboy's built-in default model
IDs, which are unprefixed and will fail against Bedrock. This includes the
conflict-resolution phase (triggered by rebase conflicts), configurable under
`[phases.defaults."conflict-resolution"]` like any other phase.

`codebase.roots` is a list of directories the intake phase can look through when
proposing scope. A top-level directory listing of each root is passed to the
intake agent so it can propose paths that actually exist rather than
plausible-sounding guesses. Without this, intake proposes scope from ticket text
alone — still useful, but the human approval gate will more often need to
correct wrong directory names.

Intake also proposes which **external sources** a ticket needs — Notion pages,
Slack channels, GitHub repos not cloned locally, external documentation URLs.
These appear as a third section in `intake.md` alongside the filesystem scope,
and are approved at the same human gate. Available external sources are declared
in config:

```toml
[sources]
notion = true
slack = true
github_orgs = ["myorg"]
```

External source access does not require MCP. Three approaches, in order of
preference for the near term:

1. **Host-side pre-fetch (recommended now):** before spawning the enrichment
   phase, the tick fetches approved external sources on the host — where
   credentials already live — and writes the results into the ticket directory
   as static files. Pi reads them like any other context file. No credentials
   passed to the agent, no new tooling required.
2. **CLI tools at agent runtime:** the agent invokes Slack CLI, `curl` against
   Notion's API, `gh` for GitHub directly via its bash tool. The enrichment
   prompt tells the agent which tools are available. Works today but exposes
   host credentials to the agent.
3. **MCP (future):** the cleanest long-term answer but blocked on Pi gaining MCP
   client support.

## Artifacts

Not all tickets produce pull requests. The `artifact` field in `meta.md`
controls what the implementation phase produces and what "merge" means:

| Value          | Implementation produces               | Merge step                              |
| -------------- | ------------------------------------- | --------------------------------------- |
| `pr` (default) | Code diff                             | Opens GitHub PR                         |
| `document`     | Written document (RFC, proposal, ADR) | Posts to destination (Confluence, etc.) |
| `none`         | No artifact                           | Closes ticket                           |

## Ceremonies

Ceremonies are time- or event-triggered automations that use the system's state
as input and produce an output (Slack standup, weekly digest, sprint report)
without a ticket or human gate. They are configured separately from the ticket
pipeline:

```toml
[[ceremony]]
name = "standup"
schedule = "0 9 * * 1-5"   # weekdays at 9am
prompt = "ceremonies/standup.md"
```

Ceremony prompts receive the state store and recent git history as context.

A particularly valuable ceremony type is **meta-review**: a recurring analysis
of recently completed tickets that extracts learnings and writes them to
`principles.md` in the state repo. Each completed ticket already produces a
`log.md` recording what happened at each phase — what feedback was given, what
corrections were made, what needed human intervention. The meta-review ceremony
reads these logs across a batch of tickets, identifies patterns, and proposes
additions to `principles.md` as improved LLM instructions for future runs. This
closes the learning loop automatically rather than requiring per-ticket
curation.

## Tech stack

Deno, TypeScript, pi (AI agent), GitHub REST API.

### Prior art

- [Devin](https://devin.ai) — commercial autonomous coding agent; assigns via
  Linear/Slack/API and ships a PR. One human gate (PR review). lazyboy differs
  in having five deliberate phase gates and owned infrastructure.
- [OpenHands](https://openhands.dev) — open source autonomous coding SDK and
  platform with GitHub/Jira/Linear integrations. Similar execution model to
  Devin; self-hostable.
- [Goose](https://goose-docs.ai) — open source multi-provider AI agent with
  MCP-based extensibility and semantic codebase understanding. Runs
  interactively or headlessly; no built-in phase gates or pipeline model.

### Pi vs Claude Code

Pi has the same dedicated file-editing tools as Claude Code (`read`, `edit`,
`write`, `bash`) and a richer hooks system (`tool_call`, `tool_result`,
`before_agent_start`, etc.). The one meaningful gap is MCP — Claude Code
supports it natively, Pi does not. For lazyboy's use case this doesn't matter:
external services are pre-fetched on the host and passed to the agent as static
context files. Pi is the primary and only planned agent.

---

## Roadmap

This project is built in sixteen sub-projects. Bootstrap is sub-project 4 — the
pipeline works end-to-end and the fastest way to discover what needs improving
is to use it on real work.

### Sub-project 1 — Core loop ✅

Minimal end-to-end pipeline. GitHub Issues as the work provider, all five human
gates, cron-based tick, pi execution.

### Sub-project 2 — Worktree isolation ✅

Before intake runs, `tick()` creates a dedicated git branch (`<ticket-id>`, e.g.
`gh-42`) and a linked working tree (`git worktree add`) in
`~/.lazyboy/worktrees/<ticket-id>/<org>/<repo>`. The branch and worktree path
are stored in `meta.md` under `worktrees.<org>/<repo>`. The implementation phase
runs pi with the worktree path as `cwd`. If no local clone of the repo is found
by scanning `codebase.roots`, the ticket moves to `needs-attention` before
intake.

Worktree removal (on merge or cleanup) is handled in SP3.

_Worktrees: `~/.lazyboy/worktrees/` · Branch: ticket ID · Base: `main`_

### Sub-project 3 — PR monitoring and cleanup ✅

The tick polls the GitHub API for any `waiting-merge` ticket whose PR has been
merged — either by the human on GitHub or by lazyboy itself. On detection, it
removes the worktree, deletes the branch, and sets the ticket to `done`. This
closes the lifecycle without requiring lazyboy to be the one who pressed merge.

_Requires: SP2_

### Sub-project 4 — Bootstrap

Use lazyboy to build lazyboy. Create GitHub Issues for sub-projects 5–16, assign
them, and let the pipeline execute them. Failures and friction here drive the
priority of everything that follows.

_Requires: SP2, SP3_

### Sub-project 5 — Per-ticket log

Each phase appends a timestamped entry to `<ticket>/log.md` so the full
lifecycle of a ticket is traceable in one place and failures can be
pattern-matched across tickets.

### Sub-project 6 — Comment-driven feedback

Editing a phase output and asking the agent to diff your changes is worse than
stating your intent directly. After reviewing a phase output, write feedback to
`<phase>-feedback-<timestamp>.md` in the ticket directory. Timestamped filenames
preserve all feedback iterations for future review and meta-analysis rather than
overwriting. The next phase reads all matching files as additional context.

When the agent re-runs a phase with a feedback file present, it must: verify the
feedback against the codebase before acting, push back with technical reasoning
if the feedback appears incorrect, and clarify all unclear items before
starting. These rules go into the feedback prompt template verbatim from the
`receiving-code-review` skill.

_Requires: SP5_

### Sub-project 7 — Principles file

`~/code/jackjennings/projects/principles.md`, committed to the state repo and
passed to every phase as context. When a phase produces a learning worth
keeping, it proposes an addition as part of its output. Approved entries are
appended and committed; rejected entries are hashed to prevent re-proposing.

_Requires: SP5, SP6_

### Sub-project 8 — Packages

Global package configuration in `config.toml` (`[packages] enabled = [...]`).
Packages are installed into pi before each phase that needs them.

### Sub-project 9 — Artifact types

Add the `artifact` field to `meta.md`; branch the implementation and merge
phases based on its value so non-PR work (RFCs, proposals) flows through the
same pipeline.

### Sub-project 10 — Ceremonies

Implement the ceremony runner — schedule-based automations (standup, digest)
that read from the state store without a ticket lifecycle.

_Requires: SP5, SP7_

### Sub-project 11 — Needs-attention notifications

Add `needs-attention` notification (Slack) so failures surface without polling
`lazyboy status`.

### Sub-project 12 — Model selection

Different phases have different reasoning requirements and cost profiles. The
plan phase should output a model recommendation for the implementation phase
alongside the implementation plan itself — the agent that writes the plan is
best placed to judge complexity.

Each phase has a sensible default, tunable in config:

| Phase            | Default                 | Reasoning                                    |
| ---------------- | ----------------------- | -------------------------------------------- |
| intake           | small (haiku)           | Reads ticket text only, no judgement needed  |
| enrichment       | medium (sonnet)         | Code reading and summarisation               |
| spec             | large + thinking budget | Requirements need careful reasoning          |
| plan             | large + thinking budget | TDD plans require anticipating failure modes |
| implementation   | large + thinking budget | Tool use + iteration under constraints       |
| automated review | medium                  | Checking diff against known spec             |

"Thinking budget" refers to Anthropic's **extended thinking** (or equivalent
reasoning effort settings on other providers) — a token allocation the model
uses for internal chain-of-thought before responding. Higher budgets improve
accuracy on complex tasks at additional cost.

Model and thinking budget are stored in `meta.md` per ticket, set by the plan
phase, and overridable in config:

```toml
[phases.defaults]
intake = { model = "claude-haiku-4-5", thinking_budget = 0 }
spec   = { model = "claude-sonnet-4-6", thinking_budget = 8000 }
plan   = { model = "claude-sonnet-4-6", thinking_budget = 8000 }
```

### Sub-project 13 — Workflow refinement

Tune the phase prompt templates against real tickets. Add confidence scoring to
phase outputs so low-confidence results get flagged before the human gate.

_Requires: SP4, SP6, SP7_

### Sub-project 14 — Automated review phase

The [Superpowers](https://github.com/anthropics/claude-code-superpowers) Claude
Code plugin encodes strong autonomous coding discipline. Between
`implementation` and `waiting-diff`, a second pi instance reviews the diff
against the spec and plan — checking TDD compliance, spec coverage, and obvious
bugs — and writes a structured report to `review.md`. The human sees a diff that
has already been machine-reviewed. This mirrors the `requesting-code-review`
skill adapted for non-interactive execution.

_Requires: SP2, SP7, SP12_

### Sub-project 15 — Jira provider

Add Jira as a work provider so tickets from a Jira board can flow through the
same pipeline. The provider interface is already abstracted — this is a new
`src/providers/jira.ts` implementing `Provider`. Jira work is tracked "on the
books" (in Jira); lazyboy state mirrors it locally.

### Sub-project 16 — Conflict resolution

When another PR merges to main after a ticket's branch was created, the branch
may conflict. The tick detects this on each run by checking the git status of
every open worktree against main. If a conflict is found, lazyboy attempts an
automatic rebase. Conflicts that resolve cleanly advance without human
intervention; conflicts that don't fall to `needs-attention` with a diagnostic
describing which files conflicted and why the rebase failed.

_Requires: SP2, SP3_

---

## Opportunities

Ideas worth exploring but not yet scheduled:

- **LLM-determined packages:** rather than a global package list, the intake
  phase proposes which packages a specific ticket needs (e.g. `agent-browser`
  for UI work, nothing for a pure backend change). This becomes part of the
  scope approval gate — the human confirms both directory access and tool access
  before any codebase-touching phase runs.

- **Network access per phase:** the enrichment phase needs open network access
  to read documentation and external resources; all other phases are locked to
  `api.anthropic.com` and `api.github.com`. Currently all phases use the same
  tight allowlist. The right design is to pass the phase name into
  `run-phase.ts` and skip `createHttpHooks` for enrichment, leaving network
  unrestricted while still injecting credentials as plain env vars. Longer term,
  the intake phase could propose a network allowlist alongside the filesystem
  scope, with human approval at the same gate.

- **On-device Apple Intelligence:** low-reasoning phases (intake, enrichment)
  could run against Apple's on-device Foundation Models via
  [apfel](https://github.com/Arthur-Ficial/apfel), eliminating API cost and
  latency for those steps entirely. Pairs with the per-phase model config
  already planned for sub-project 5. Pi supports any OpenAI-compatible provider
  via `models.json`, and apfel exposes an OpenAI-compatible interface — so this
  is a supported pi configuration path with no lazyboy code changes required.

- **Self-hosted models for low-reasoning phases:** intake and enrichment don't
  require frontier models — they read text and follow instructions. A
  locally-run model (Ollama, llama.cpp) could handle these phases at near-zero
  marginal cost, reserving paid API calls for spec, plan, and implementation.
  The model selection config above makes this a per-phase swap rather than a
  system-wide change.

- **Work item creation:** any phase that identifies deferred work — a bug found
  during enrichment, a prerequisite surfaced during spec, a refactor noted
  during implementation — should be able to create a new ticket in the
  originating system rather than expanding scope or losing the finding. This
  requires a `createWorkItem()` method on the `Provider` interface alongside
  `fetchNew()`. The new ticket enters the queue like any other and is processed
  on a future tick. This is the primary mechanism for keeping individual tickets
  focused and avoiding scope creep.

- **`lazyboy ps` and real-time monitoring:** `ps` would scan all `meta.md` files
  for `phase: running-*` tickets and print the active agent processes with their
  PID, phase, and ticket title. A `top`-style TUI would extend this with live
  refresh, showing ticket progression, phase durations, and concurrency
  utilisation in real-time.

- **Dynamic credentials:** `~/.config/lazyboy/env` is a static file, but some
  credentials have short lifespans and need refreshing on a cadence (e.g. AWS
  CodeArtifact tokens, short-lived OAuth tokens). A future extension could allow
  env entries to specify a refresh command alongside the value — lazyboy would
  re-run the command before each tick and inject the fresh value. Format could
  follow the pattern of shell credential helpers (similar to `credential.helper`
  in git config).

- **MCP support:** once Pi gains MCP client support, the host-side pre-fetch
  approach for external sources (Slack, Notion, GitHub) can be replaced with MCP
  servers running on the host and exposed to the enrichment VM. This gives the
  agent interactive query capability — follow links, ask follow-up questions,
  paginate results — rather than working from a static snapshot. The same
  mechanism would enable MCP-based tool use in other phases (e.g. posting to
  Slack from a ceremony, updating a Jira ticket on merge).

- **Work dependencies:** some tickets can't start until others are complete. A
  `depends_on` field in `meta.md` would let the tick loop skip tickets whose
  dependencies aren't yet in `done` state. The intake phase is a natural place
  to propose dependencies — it already reads the ticket and has enough context
  to identify blocking relationships. Dependencies could also be sourced
  directly from the provider (GitHub Issues and Jira both support
  linked/blocked-by relationships).
