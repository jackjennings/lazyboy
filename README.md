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
  meta.md        # phase, approved, scope, title, url
  intake.md      # scope proposal
  enrichment.md  # codebase context
  spec.md        # specification
  plan.md        # implementation plan
  diff.md        # implementation diff summary
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
```

## Tech stack

Deno, TypeScript, gondolin (micro-VM sandboxing), pi (AI agent), GitHub REST API.

---

## Roadmap

This project is built in four sub-projects. The goal is to use lazyboy to build itself starting from sub-project 3.

### Sub-project 1 — Core loop ✅

Minimal end-to-end pipeline. GitHub Issues as the work provider, all five human gates, cron-based tick, gondolin + pi execution.

### Sub-project 2 — Workflow refinement

Tune the phase prompt templates against real tickets. Add `needs-attention` notification (Slack or similar) so failures surface without polling `lazyboy status`. Add confidence scoring to phase outputs so low-confidence results get flagged before the human gate.

### Sub-project 3 — Jira provider

Add Jira as a work provider so tickets from `smarterdx` Jira boards can flow through the same pipeline. The provider interface is already abstracted — this is a new `src/providers/jira.ts` implementing `Provider`. Jira work is tracked "on the books" (in Jira); lazyboy state mirrors it locally.

### Sub-project 4 — Bootstrap

Use lazyboy to build lazyboy. Create GitHub Issues for sub-projects 2 and 3, assign them, and let the pipeline execute them. This is the first real end-to-end test of the system against non-trivial work.
