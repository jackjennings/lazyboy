# lazyboy

Automates software development so human time is spent only on tasks requiring judgement. Polls for assigned work, runs each ticket through a phase pipeline via an AI agent in a sandboxed VM, and pauses at each phase boundary for human approval.

## How it works

Each ticket moves through six phases:

| Phase | What runs | Human gate |
|---|---|---|
| **intake** | Proposes which repos the ticket needs access to | Approve scope |
| **enrichment** | Gathers context from the codebase | Review context |
| **spec** | Writes a precise specification | Validate spec |
| **plan** | Writes a TDD implementation plan | Approve plan |
| **implementation** | Writes the code | Review diff |
| **merge** | — | Authorize merge |

Each phase runs [pi](https://pi.dev) inside a [gondolin](https://github.com/earendil-works/gondolin) micro-VM. The VM gets only the filesystem paths and network hosts it needs for that phase — nothing else.

A cron job runs `lazyboy tick` every 15 minutes. Tickets advance automatically until they hit a gate, then wait for `lazyboy approve <id>`.

## Usage

```bash
lazyboy tick           # advance all active tickets (run by cron)
lazyboy approve <id>   # approve the current phase gate
lazyboy status         # show all active tickets
lazyboy enable         # add cron job (runs tick every 15 minutes)
lazyboy disable        # remove cron job
```

Cron invokes `scripts/tick.sh`, which handles token capture and env setup. To override env vars (e.g. `ANTHROPIC_API_KEY`), add them to `~/.config/lazyboy/env`.

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

Approval is as simple as opening `meta.md` and setting `approved: true`, or running `lazyboy approve gh-42`.

## Config

`~/.config/lazyboy/config.toml`:

```toml
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2

[plugins]
enabled = ["agent-browser"]
```

## Artifacts

Not all tickets produce pull requests. The `artifact` field in `meta.md` controls what the implementation phase produces and what "merge" means:

| Value | Implementation produces | Merge step |
|---|---|---|
| `pr` (default) | Code diff | Opens GitHub PR |
| `document` | Written document (RFC, proposal, ADR) | Posts to destination (Confluence, etc.) |
| `none` | No artifact | Closes ticket |

## Ceremonies

Ceremonies are time- or event-triggered automations that use the system's state as input and produce an output (Slack standup, weekly digest, sprint report) without a ticket or human gate. They are configured separately from the ticket pipeline:

```toml
[[ceremony]]
name = "standup"
schedule = "0 9 * * 1-5"   # weekdays at 9am
prompt = "ceremonies/standup.md"
```

Ceremony prompts receive the state store and recent git history as context.

## Tech stack

Deno, TypeScript, gondolin (micro-VM sandboxing), pi (AI agent), GitHub REST API.

### Pi vs Claude Code

Pi has the same dedicated file-editing tools as Claude Code (`read`, `edit`, `write`, `bash`) and a richer hooks system (`tool_call`, `tool_result`, `before_agent_start`, etc.). The one meaningful gap is MCP — Claude Code supports it natively, Pi does not. For lazyboy's use case this doesn't matter: external services are handled at the host level by gondolin, not inside the agent. Pi is the primary and only planned agent.

---

## Roadmap

This project is built in five sub-projects. The goal is to use lazyboy to build itself starting from sub-project 5.

### Sub-project 1 — Core loop ✅

Minimal end-to-end pipeline. GitHub Issues as the work provider, all five human gates, cron-based tick, gondolin + pi execution.

### Sub-project 2 — Feedback and memory

- **Comment-driven feedback:** editing a phase output and asking the agent to diff your changes is worse than stating your intent directly. After reviewing a phase output, write feedback to `<phase>-feedback.md` in the ticket directory. The next phase reads it as additional context.
- **Principles file:** `~/code/jackjennings/projects/principles.md`, committed to the state repo and passed to every phase as context. When a phase produces a learning worth keeping, it proposes an addition as part of its output. Approved entries are appended and committed; rejected entries are hashed to prevent re-proposing.
- **Per-ticket log:** each phase appends a timestamped entry to `<ticket>/log.md` so the full lifecycle of a ticket is traceable in one place and failures can be pattern-matched across tickets.

### Sub-project 3 — Ceremonies, artifacts, and plugins

- **Ceremonies:** implement the ceremony runner — schedule-based automations (standup, digest) that read from the state store without a ticket lifecycle.
- **Artifact types:** add the `artifact` field to `meta.md`; branch the implementation and merge phases based on its value so non-PR work (RFCs, proposals) flows through the same pipeline.
- **Plugins:** global plugin configuration in `config.toml` (`[plugins] enabled = [...]`). Plugins are installed into the gondolin VM before each phase that needs them.

### Sub-project 4 — Workflow refinement

Tune the phase prompt templates against real tickets. Add `needs-attention` notification (Slack) so failures surface without polling `lazyboy status`. Add confidence scoring to phase outputs so low-confidence results get flagged before the human gate.

### Sub-project 5 — Jira provider

Add Jira as a work provider so tickets from `smarterdx` Jira boards can flow through the same pipeline. The provider interface is already abstracted — this is a new `src/providers/jira.ts` implementing `Provider`. Jira work is tracked "on the books" (in Jira); lazyboy state mirrors it locally.

### Sub-project 6 — Bootstrap

Use lazyboy to build lazyboy. Create GitHub Issues for sub-projects 2–5, assign them, and let the pipeline execute them. This is the first real end-to-end test of the system against non-trivial work.

---

## Opportunities

Ideas worth exploring but not yet scheduled:

- **LLM-determined plugins:** rather than a global plugin list, the intake phase proposes which plugins a specific ticket needs (e.g. `agent-browser` for UI work, nothing for a pure backend change). This becomes part of the scope approval gate — the human confirms both directory access and tool access before any codebase-touching phase runs.
