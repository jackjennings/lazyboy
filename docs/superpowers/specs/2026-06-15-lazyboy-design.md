# lazyboy — Sub-project 1: Core Loop

**Date:** 2026-06-15
**Scope:** Sub-project 1 of 4. Builds the minimal end-to-end automation loop. Subsequent sub-projects add the full workflow phase pipeline, bootstrap (using lazyboy to build lazyboy), and extensions (multi-provider, notifications).

---

## Goal

Automate software development work so that human time is spent only on tasks requiring judgement. lazyboy polls for assigned work, runs each ticket through a phase pipeline via an AI agent in a sandboxed VM, and pauses at each phase boundary for human review before proceeding.

---

## Repository

- **Code:** `~/code/jackjennings/lazyboy` (new git repo, TypeScript + Deno)
- **State:** `~/code/jackjennings/projects/` (existing or new git repo, plain text)
- **Config:** `~/.config/lazyboy/`

---

## Architecture

### Trigger

A cron job runs `lazyboy tick` every 15 minutes. No long-running daemon.

### Provider Interface

An abstract TypeScript interface that returns `WorkItem[]`. The first implementation polls GitHub Issues assigned to the configured user. Jira and other providers are added later without changing core logic.

gondolin and the pi SDK are imported via Deno's `npm:` compat prefix (e.g. `import { VM } from "npm:@earendil-works/gondolin"`). No node_modules or package.json required. `deno compile` can produce a standalone binary for distribution in a later sub-project.

```
interface Provider {
  fetchNew(knownIds: Set<string>): Promise<WorkItem[]>
}

interface WorkItem {
  id: string          // e.g. "gh-42"
  provider: string    // "github"
  title: string
  description: string
  url: string
}
```

Configured repos are listed in `~/.config/lazyboy/config.toml` under `github.repos[]`. The provider fetches open issues assigned to the authenticated user across all listed repos, filters out IDs already present in the state store, and returns the remainder.

### State Store

One directory per ticket in `~/code/jackjennings/projects/`:

```
gh-42/
  meta.md        # frontmatter: phase, approved, scope, title, url
  intake.md      # scope proposal and reasoning (written by intake agent)
  enrichment.md  # context gathered (written by enrichment agent)
  spec.md        # generated specification
  plan.md        # implementation plan
  diff.md        # implementation diff summary
```

`meta.md` frontmatter:

```yaml
---
id: gh-42
provider: github
title: Add dark mode support
url: https://github.com/jackjennings/lazyboy/issues/42
phase: waiting-intake
approved: false
scope:
  - ~/code/smarterdx/notes-frontend
  - ~/code/smarterdx/design-tokens
created: 2026-06-15T10:00:00Z
updated: 2026-06-15T10:05:00Z
---

(ticket description / notes body)
```

After each tick that changes state, all modified files are committed to git: `git add -A && git commit -m "tick: <summary>"`.

### Executor

Each phase runs `pi -p "<prompt>" @<context-files>` inside a gondolin micro-VM. The VM is configured per ticket using the approved scope:

- **Read-only mounts:** directories listed in `meta.md`'s `scope[]` (only after `scope_approved: true`)
- **Read/write mounts:** the ticket's project dir; a cloned repo worktree (implementation phases only)
- **Injected credentials:** `GITHUB_TOKEN` (forwarded to `api.github.com` only), `ANTHROPIC_API_KEY`
- **Network:** allowlisted hosts only; no arbitrary outbound access

Phase prompts are template files in `src/phases/`. The executor writes agent stdout to the appropriate output file (`intake.md`, `enrichment.md`, etc.) and updates `meta.md` phase and timestamps.

### Tick Loop

```
tick()
  1. Acquire lock — write ~/.config/lazyboy/tick.pid (PID). Exit if lock exists and PID is alive.
  2. Fetch new work — call each active provider, create meta.md for new tickets (phase: new).
  3. Advance tickets — for each active ticket in the state store:
       - phase: new              → spawn gondolin VM for intake (no codebase mounts), set phase: running-intake, record child PID in meta.md
       - phase: running-*        → check if child PID has exited; on success write output file, set phase: waiting-*; on failure set phase: needs-attention
       - phase: waiting-* + approved: true → clear approved, spawn next phase VM (using approved scope for all phases after intake), set phase: running-*
       - phase: needs-attention  → skip (human must intervene)
  4. Commit state — git add -A && git commit in projects repo (skip if nothing changed).
  5. Release lock — delete tick.pid.
```

Agent phases are **asynchronous**: the tick spawns a gondolin process, records its PID in `meta.md`, and exits. The running process outlives the tick invocation. The next tick detects completion by checking whether the PID is still alive.

Concurrency limit (`tick_concurrency` in config) caps how many tickets can be in a `running-*` state simultaneously.

---

## Phase Pipeline

| Phase | VM codebase access | Output file | Human gate |
|---|---|---|---|
| intake | none (ticket text only) | `intake.md` | Approve scope in `meta.md` |
| enriching | approved scope (read-only) | `enrichment.md` | Review enrichment |
| spec | approved scope (read-only) | `spec.md` | Validate spec |
| planning | approved scope (read-only) | `plan.md` | Approve plan |
| implementing | approved scope + worktree (read/write) | `diff.md` | Review diff |
| merging | — (lazyboy calls GitHub API) | — | Authorize merge |

Intake is the only phase with no codebase access. Its sole job is to read the ticket and propose a scope. Approving intake (setting `approved: true`) confirms the scope — no separate `scope_approved` field. All subsequent phases mount only the dirs listed in `scope[]`.

---

## Human Gates

Two mechanisms, equivalent:

1. **Edit the file** — open `gh-42/meta.md`, review the phase output file, set `approved: true`, save. Next tick advances.
2. **CLI** — `lazyboy approve gh-42` sets `approved: true` in frontmatter and commits.

`lazyboy status` prints a table of all active tickets with their current phase and whether they are waiting for approval.

---

## Configuration

`~/.config/lazyboy/config.toml`:

```toml
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2
```

Runtime files also in `~/.config/lazyboy/`: `tick.pid` (lock).

---

## Code Structure

```
~/code/jackjennings/lazyboy/
  src/
    index.ts              # CLI entrypoint (tick, approve, status commands)
    tick.ts               # main loop
    executor.ts           # gondolin VM wrapper
    providers/
      interface.ts        # Provider interface and WorkItem type
      github.ts           # GitHub Issues implementation
    phases/
      intake.ts
      enrichment.ts
      spec.ts
      plan.ts
      implementation.ts
      prompts/            # pi prompt templates per phase
    state/
      store.ts            # read/write meta.md and phase output files
      types.ts            # Phase, TicketState, etc.
  deno.json                 # replaces package.json + tsconfig.json
```

---

## Out of Scope (Sub-project 1)

- Jira provider
- Notification on needs-attention (Slack, email, etc.)
- Web UI / dashboard
- Automatic scope approval (skipping the human gate)
- Bootstrap: using lazyboy to build lazyboy (sub-project 3)
