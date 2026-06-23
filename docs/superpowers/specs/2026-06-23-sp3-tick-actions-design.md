# SP3 — Tick Actions: PR Monitoring and Cleanup

## Overview

Sub-project 3 adds PR merge detection to the tick loop: when a `waiting-merge` ticket's pull request is merged by a human on GitHub, lazyboy detects it on the next tick, removes the worktree, deletes the branch, and sets the ticket to `done`.

To support this without expanding `tick.ts`, this design introduces a `TickAction` interface — a lightweight plugin point for per-tick per-ticket operations. The existing inline worktree creation logic is refactored into the first `TickAction`; PR merge detection is the second.

**Scope:** PR detection and cleanup only. lazyboy initiating a merge is deferred to a later sub-project.

---

## Architecture

The tick loop becomes two passes:

1. **Action pass** — runs all registered `TickAction`s against every ticket. Actions self-filter via `applies()` and return an updated ticket or `null`. The resulting ticket state feeds the next pass.
2. **Advance pass** — existing `advancePhase` logic, unchanged, operating on post-action ticket state.

This keeps `advancePhase` pure and untouched, and keeps `tick()` from growing as new per-tick concerns are added.

---

## TickAction Interface

```ts
// src/tick-actions/types.ts

interface TickAction {
  applies(ticket: TicketState): boolean;
  run(ticket: TicketState, stateDir: string): Promise<TicketState | null>;
}
```

Each action is created by a factory function that closes over its specific deps — no shared fat deps object. Actions are registered as a `TickAction[]` array constructed in `tick()`.

---

## Actions

### `createWorktreeAction` (`src/tick-actions/create-worktree.ts`)

Refactors the existing inline worktree creation block from `tick()`.

**Applies when:** `phase === "new"` and `worktrees` is empty.

**Deps:**
```ts
interface CreateWorktreeDeps {
  roots: string[];
  findLocalRepo: (roots: string[], slug: string) => Promise<string | null>;
  createWorktree: (repoPath: string, ticketId: string, slug: string) => Promise<WorktreeInfo>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
}
```

**Behavior:**
- No local repo found → returns ticket with `phase: "needs-attention"`
- `createWorktree` throws → returns ticket with `phase: "needs-attention"`
- Success → returns ticket with `worktrees` populated

Identical outcome to the current inline logic; this is a pure refactor.

---

### `checkMergedPRAction` (`src/tick-actions/check-merged-pr.ts`)

**Applies when:** `phase === "waiting-merge"` and `prUrl` is defined.

**Deps:**
```ts
interface CheckMergedPRDeps {
  isPRMerged: (prUrl: string) => Promise<boolean>;
  cleanupWorktree: (wt: WorktreeInfo) => Promise<void>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
}
```

`cleanupWorktree` handles both `git worktree remove` and `git branch -D` in one dep. Combining them avoids an ordering problem: after `git worktree remove`, the worktree path no longer exists and `git rev-parse --git-common-dir` (used to locate the main repo) cannot run. The implementation resolves the main repo path via `--git-common-dir` before removal, then runs both git commands from the main repo.

**Behavior:**
- `isPRMerged` returns `true` → remove each worktree, delete each branch, return ticket with `phase: "done"`
- `isPRMerged` returns `false` → return `null` (no change, check again next tick)
- `isPRMerged` throws → log error, return `null` (transient; do not set `needs-attention`)
- Cleanup (`removeWorktree` / `deleteBranch`) throws → log error, still return ticket with `phase: "done"` (human can clean up manually; lifecycle must not stall)

`isPRMerged` uses the GitHub API endpoint `GET /repos/{owner}/{repo}/pulls/{number}/merge` (204 = merged, 404 = not merged). The PR number and repo are extracted from `prUrl`.

---

## Data Model

One new optional field on `TicketState`:

```ts
prUrl?: string;
```

`readTicket` reads it from YAML frontmatter; `writeTicket` omits it when undefined (same pattern as `pid`). No migration needed — missing field reads as `undefined`.

`prUrl` is set externally: by `pi` writing to `meta.md` during the implementation phase, or manually by the human. The tick never sets `prUrl`.

---

## Tick Loop

```ts
// Action pass
let processedTickets = [...tickets];
for (let i = 0; i < processedTickets.length; i++) {
  for (const action of tickActions) {
    if (action.applies(processedTickets[i])) {
      const updated = await action.run(processedTickets[i], stateDir);
      if (updated !== null) processedTickets[i] = updated;
    }
  }
}

// Advance pass (existing logic, now uses processedTickets)
for (const ticket of processedTickets) {
  if (["needs-attention", "done", "waiting-merge"].includes(ticket.phase)) continue;
  // ... concurrency check and advancePhase call
}
```

`tickActions` is constructed in `tick()` after config and token are loaded. No global mutable registry.

---

## Testing

**`src/tick-actions/create-worktree_test.ts`**
- No local repo → `needs-attention`
- `createWorktree` throws → `needs-attention`
- Success → `worktrees` populated

**`src/tick-actions/check-merged-pr_test.ts`**
- `isPRMerged` true → `phase: "done"`, cleanup called
- `isPRMerged` false → `null`
- `isPRMerged` throws → `null`, cleanup not called
- Cleanup throws → still returns `phase: "done"`

**`tick_test.ts`** — existing `advancePhase` tests are unchanged.

---

## File Additions and Changes

| File | Change |
|---|---|
| `src/tick-actions/types.ts` | New — `TickAction` interface |
| `src/tick-actions/create-worktree.ts` | New — refactored from `tick()` |
| `src/tick-actions/check-merged-pr.ts` | New — PR merge detection |
| `src/tick-actions/create-worktree_test.ts` | New |
| `src/tick-actions/check-merged-pr_test.ts` | New |
| `src/state/types.ts` | Add `prUrl?: string` to `TicketState` |
| `src/state/store.ts` | Read/write `prUrl` |
| `src/tick.ts` | Two-pass loop; remove inline worktree block; construct `tickActions` |
