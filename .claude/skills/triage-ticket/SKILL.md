---
name: triage-ticket
description: Use when a lazyboy ticket is parked at needs-attention, stuck in a phase, missing its PRs, silently skipped by the tick, or otherwise did not do what it should have — and you need to work out what happened from the state repo and the source.
---

# Triaging a lazyboy ticket

## Overview

Every failure a ticket can have leaves three kinds of evidence: the event log
(`log.ndjson`), the on-disk artifacts (phase outputs, `.exit`, `meta.md`), and
the state repo's git history. Triage is reading those in order and then finding
the code that emitted the event — never inferring the cause from the reason
label alone.

The output of a triage is a timeline, a root cause at `file:line`, and a
judgement on whether the incident is a one-off or a defect worth a ticket.

If the tick itself is not running — no recent `tick.ndjson` entries, persistent
401s, or macOS permission prompts — use `debug-tick` instead.

## Locate the ticket

The state dir is `[state].dir` in `~/.config/lazyboy/config.toml`. A ticket ID
is a relative path under it:

```
$STATE_DIR/github/<org>/<repo>/<n>/     # or jira/<KEY>/
  meta.md                               # frontmatter: phase, status, approvals, prs, worktrees
  log.ndjson                            # the event log — read this second
  <timestamp>-<phase>.md                # phase output the agent wrote
  <timestamp>-<phase>.md.exit           # phase subprocess exit code
  <timestamp>-<phase>.usage.json        # only written on a clean agent_end
  <timestamp>-ci-fix-context-*.md       # unconsumed → resolveCIFixAction still owes work
```

`lazyboy status` and `lazyboy tail <id>` cover the same ground; reading the
files directly is usually faster and always complete.

## Procedure

1. **Read `meta.md` and the tail of `log.ndjson`.** `phase` + `status` is where
   the ticket is now; the last few events are how it got there.
2. **Find the last non-routine event.** `phase-start`/`phase-end`/
   `status-transition`/`phase-transition` between runner phases are normal.
   Anything carrying a `reason`, plus `error` and `*-failed`, is the incident.
3. **Identify the emitter from the `event` name, not the `reason`.** Two code
   paths emit the same label with different meanings — see the table below.
   Grepping the literal in `src/` finds most of them; when it does not, the
   label came from `ARTIFACT_DESCRIPTORS` (`src/state/types.ts`) via
   `descriptor.missingReason`.
4. **Read that code and check its precondition against the ticket.** Most parks
   are a guard reading one field (`ticket.prs`, `ticket.worktrees`) that was
   never populated. Confirm the field's actual value in `meta.md`.
5. **Corroborate with the artifacts.** Does the phase output contain what the
   guard was looking for? What is in `.exit`? An `exitCode: 0` phase-end next to
   a park means the agent succeeded and lazyboy rejected its work — a very
   different bug from an agent crash.
6. **Build the timeline from the state repo's git log.** Tick commits are
   `tick: <iso>`; human ones are `approve:`/`retry:`/`decline:`. Showing a path
   at a given commit proves what the file held at that tick, which settles "was
   the file there yet?" questions that mtimes cannot.
7. **Check whether it is systemic.** Count the label across every ticket log in
   the state dir. A label with many hits across unrelated tickets is a defect,
   not an incident.
8. **Re-read `meta.md` before reporting.** Ticks run every ~6 minutes and may
   have resolved the ticket while you were reading. Report the current state,
   not the state you started from.

## Reason labels and their emitters

| `reason`                                                                                                                       | Emitted by                                               | Means                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `incomplete`                                                                                                                   | `advancePhase`, exit-code check                          | No exit code recorded — the phase process died without one.                                   |
| `non-zero-exit`                                                                                                                | `advancePhase`, exit-code check                          | Phase subprocess exited non-zero.                                                             |
| `missing` / `empty`                                                                                                            | `advancePhase`, output-file check                        | Output file absent (after one resume attempt) or blank.                                       |
| `no-prs` / `no-pages` (`phase-transition`)                                                                                     | `advancePhase`, artifact completion guard                | The artifact's `completionField` is empty in frontmatter. Says nothing about the output file. |
| `no-prs` (`needs-attention`)                                                                                                   | `reconcilePRsAction`                                     | Output file scanned, no PR URL in it.                                                         |
| `pr-fetch-failed`                                                                                                              | `reconcilePRsAction`                                     | PR URL found, GitHub metadata call threw.                                                     |
| `agent-failed`                                                                                                                 | `resolveConflictsAction`                                 | Conflict-resolution agent did not finish the rebase.                                          |
| `worktree-creation-failed` / `clone-failed`                                                                                    | `createWorktreeAction`                                   | Setup failed before any phase ran.                                                            |
| `ci-unfixable` / `no-commit` / `no-verdict-line` / `output-file-missing` / `infra-rerun-exhausted` / `context-file-unreadable` | `resolveCIFixAction`                                     | CI-fix verdict handling; see the CI fix section of CLAUDE.md.                                 |
| `no-worktrees`                                                                                                                 | `advancePhase`, `spawnCIFixAction`, `resolveCIFixAction` | Three unrelated sites — check the `event` to tell them apart.                                 |

Symbols, not line numbers: each action lives in
`src/tick-actions/<kebab-name>.ts`, `advancePhase` in `src/tick.ts`. Grep the
identifier, then the `reason` literal within it.

## Gotchas

- **Log timestamps are UTC; `ls`/`stat` mtimes are local.** Convert before
  claiming one thing preceded another.
- **The same `reason` from a different `event` is a different bug.** `no-prs` as
  a `phase-transition` is `advancePhase`'s frontmatter guard; as a
  `needs-attention` it is `reconcilePRsAction` having actually read the file.
- **A park can starve the action that would have fixed it.** Most actions
  require `status === "waiting"`; a ticket parked by `advancePhase` in the same
  tick never reaches them until a human runs `lazyboy retry`.
- **`git log` on the state dir only shows committed ticks.** `commitState` runs
  at the end of a tick, so an in-flight tick's writes are on disk but not in the
  history yet.
- **A live phase agent explains "nothing happened."** Actions skip tickets where
  `isPhaseAlive(ticketDir)` is true; check for `run.pid` before hunting a bug.

## Getting the ticket moving again

| Command                                    | What it does                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `echo "<feedback>" \| lazyboy review <id>` | Writes `<timestamp>-<phase>-feedback.md` (named after `ticket.phase`), sets `status: "revising"`, commits `review: <id>`. The next tick re-runs the current phase with the feedback in context. This is the only way to re-run a phase.                                                                                                                                                 |
| `lazyboy retry <id>`                       | Requires `status === "needs-attention"`. Flips status to `waiting` (`new` when `phase === "intake"`). Re-runs nothing — only unparks the ticket so the next tick can advance it.                                                                                                                                                                                                        |
| `lazyboy rewind <id> <phase>`              | Sends the ticket back to `<phase>`. Refuses a target after the current phase and refuses if the ticket has open PRs. Archives that phase's and all later phases' artifacts (`.md`, `.md.exit`, `.md.session`, `.usage.json`, `-self-review.md`, `-feedback.md`); drops approvals and `phaseSessionIds` for the target phase and later; sets `status` to `waiting` (`new` for `intake`). |
| `lazyboy approve <id>`                     | Appends a human `ApprovalEntry`.                                                                                                                                                                                                                                                                                                                                                        |
| `lazyboy decline <id> [reason]`            | Moves the ticket to `wont-do`/`done`; does not close the upstream issue.                                                                                                                                                                                                                                                                                                                |

Caveats:

- Prefer the piped review over hand-editing `meta.md`. `isApproved`
  (`src/state/types.ts`) compares only the last approval entry's phase against
  `ticket.phase`, so a stale entry left in place can auto-advance the ticket on
  the next tick.
- `lazyboy review` requires that the latest phase output file matches the
  current phase (`found.phaseName !== ticket.phase` exits with error). If the
  current phase never produced an output, use `rewind` to return to the last
  phase that did produce one, then re-advance.
- To force a fresh agent session instead of a resume, delete
  `phaseSessionIds[<phase>]` from `meta.md` before piping the review.
- Nothing to restart after any of these commands. The next tick (every 5
  minutes, `StartInterval: 300`) picks up the change; the state repo commit each
  command makes is the audit trail.

## Reporting

Lead with the sequence — timestamped, four or five lines, ending in the current
state. Then the root cause as `file:line` with the condition that was actually
false. Then say plainly whether it is still broken or already self-healed.

Keep the incident and the defect separate: "this ticket needs a retry" and "this
guard can never succeed" are two different statements, and only the second is
worth a ticket. File it against the repo holding the defective code — the
lazyboy source repo for a pipeline bug, not the repo the ticket was working in.
Follow that repo's `.github/ISSUE_TEMPLATE.md` and quote the log excerpt as
evidence.
