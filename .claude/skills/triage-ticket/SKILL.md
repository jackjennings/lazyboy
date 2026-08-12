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

| `reason`                                                                                                                       | Emitter                                                       | Means                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `missing`                                                                                                                      | `tick.ts:435` (`phase-output-invalid`)                        | Agent exited without writing its output file; one resume was already tried.                                 |
| `empty` / `incomplete`                                                                                                         | `tick.ts:448` / `:364`                                        | Output file present but unusable.                                                                           |
| `no-prs` (`needs-attention`)                                                                                                   | `reconcile-prs.ts:91`                                         | Output file scanned, no PR URL in it.                                                                       |
| `no-prs` / `no-pages` (`phase-transition`)                                                                                     | `tick.ts:453-469`                                             | Inline guard: the artifact's `completionField` in frontmatter is empty. Says nothing about the output file. |
| `pr-fetch-failed`                                                                                                              | `reconcile-prs.ts:119`                                        | PR URL found, GitHub metadata call threw.                                                                   |
| `agent-failed`                                                                                                                 | `resolve-conflicts.ts:111`                                    | Conflict-resolution agent did not finish the rebase.                                                        |
| `worktree-creation-failed` / `clone-failed`                                                                                    | `create-worktree.ts:153` / `:117`                             | Setup failed before any phase ran.                                                                          |
| `ci-unfixable` / `no-commit` / `no-verdict-line` / `output-file-missing` / `infra-rerun-exhausted` / `context-file-unreadable` | `resolve-ci-fix.ts`                                           | CI-fix verdict handling; see the CI fix section of CLAUDE.md.                                               |
| `no-worktrees`                                                                                                                 | `tick.ts:621`, `spawn-ci-fix.ts:104`, `resolve-ci-fix.ts:146` | Three unrelated sites — check the `event` to tell them apart.                                               |

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
