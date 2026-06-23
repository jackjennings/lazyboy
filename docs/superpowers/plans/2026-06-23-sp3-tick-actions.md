# SP3 — Tick Actions: PR Monitoring and Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `TickAction` plugin interface for per-tick per-ticket operations, refactor worktree creation into the first action, and add PR merge detection as the second.

**Architecture:** The tick loop becomes two passes: an action pass (all registered `TickAction`s run against every ticket via `applies()` filtering, returning updated state or `null`) followed by the existing advance pass (`advancePhase` logic, unchanged). Each action is created by a factory function that closes over typed deps — same dependency-injection pattern as `advancePhase` and `GitHubProvider`. Two initial actions: `createWorktreeAction` (refactored from inline `tick()` code) and `checkMergedPRAction` (new, polls GitHub's merge endpoint for `waiting-merge` tickets with a `prUrl`).

**Tech Stack:** Deno, TypeScript, GitHub REST API (`/repos/{owner}/{repo}/pulls/{number}/merge`), `jsr:@std/assert` for tests.

## Global Constraints

- Run all tests: `deno task test`
- Run single file: `deno test --allow-all src/path/to/file_test.ts`
- No new external dependencies — use only what's in `deno.json`
- No comments in code unless the why is non-obvious
- Test behavior, not implementation — tests must survive refactoring
- Imports use bare specifiers matching `deno.json` (`@std/path`, `jsr:@std/assert`, etc.)

---

### Task 1: Add `prUrl` to data model

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/store.ts`

**Interfaces:**
- Produces: `TicketState.prUrl?: string` — consumed by Task 5

- [ ] **Step 1: Add `prUrl` to `TicketState`**

In `src/state/types.ts`, add one field to the `TicketState` interface after `worktrees`:

```ts
export interface TicketState {
  id: string;
  provider: string;
  title: string;
  url: string;
  phase: Phase;
  approved: boolean;
  scope: string[];
  pid?: number;
  worktrees: Record<string, WorktreeInfo>;
  prUrl?: string;
  created: string;
  updated: string;
  body: string;
}
```

- [ ] **Step 2: Read `prUrl` in `readTicket`**

In `src/state/store.ts`, in the `readTicket` return object, add `prUrl` after `worktrees`:

```ts
  return {
    id: data.id,
    provider: data.provider,
    title: data.title,
    url: data.url,
    phase: data.phase as Phase,
    approved: data.approved ?? false,
    scope: data.scope ?? [],
    pid: data.pid,
    worktrees,
    prUrl: data.prUrl,
    created: data.created,
    updated: data.updated,
    body: content.trim(),
  };
```

- [ ] **Step 3: Write `prUrl` in `writeTicket`**

In `src/state/store.ts`, in `writeTicket`, add the `prUrl` conditional after the `pid` conditional:

```ts
  if (ticket.pid !== undefined) frontmatter.pid = ticket.pid;
  if (ticket.prUrl !== undefined) frontmatter.prUrl = ticket.prUrl;
```

- [ ] **Step 4: Run tests**

```bash
deno task test
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/types.ts src/state/store.ts
git commit -m "feat: add prUrl field to TicketState"
```

---

### Task 2: Create `TickAction` interface

**Files:**
- Create: `src/tick-actions/types.ts`

**Interfaces:**
- Produces: `TickAction` — `applies(ticket: TicketState): boolean` and `run(ticket: TicketState, stateDir: string): Promise<TicketState | null>` — consumed by Tasks 3, 4, 5, 6

- [ ] **Step 1: Create `src/tick-actions/types.ts`**

```ts
import type { TicketState } from "../state/types.ts";

export interface TickAction {
  applies(ticket: TicketState): boolean;
  run(ticket: TicketState, stateDir: string): Promise<TicketState | null>;
}
```

- [ ] **Step 2: Run tests**

```bash
deno task test
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tick-actions/types.ts
git commit -m "feat: add TickAction interface"
```

---

### Task 3: Create `createWorktreeAction`

**Files:**
- Create: `src/tick-actions/create-worktree.ts`
- Create: `src/tick-actions/create-worktree_test.ts`

**Interfaces:**
- Consumes: `TickAction` from `./types.ts`; `TicketState`, `WorktreeInfo` from `../state/types.ts`; `extractGitHubSlug` from `../worktree.ts`
- Produces: `createWorktreeAction(deps: CreateWorktreeDeps): TickAction` — consumed by Task 4

`CreateWorktreeDeps`:
```ts
interface CreateWorktreeDeps {
  roots: string[];
  findLocalRepo: (roots: string[], slug: string) => Promise<string | null>;
  createWorktree: (repoPath: string, ticketId: string, slug: string) => Promise<WorktreeInfo>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
}
```

- [ ] **Step 1: Write failing tests**

Create `src/tick-actions/create-worktree_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { createWorktreeAction } from "./create-worktree.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1",
    provider: "github",
    title: "T",
    url: "https://github.com/myorg/myrepo/issues/1",
    phase: "new",
    approved: false,
    scope: [],
    worktrees: {},
    created: "2026-06-23T00:00:00Z",
    updated: "2026-06-23T00:00:00Z",
    body: "",
    ...overrides,
  };
}

function makeAction(overrides: Partial<Parameters<typeof createWorktreeAction>[0]> = {}) {
  return createWorktreeAction({
    roots: ["/code"],
    findLocalRepo: async () => null,
    createWorktree: async () => ({ path: "/wt/myorg/myrepo", branch: "gh-1" }),
    writeTicket: async () => {},
    ...overrides,
  });
}

Deno.test("createWorktreeAction: applies to new ticket with no worktrees", () => {
  assertEquals(makeAction().applies(makeTicket({ phase: "new", worktrees: {} })), true);
});

Deno.test("createWorktreeAction: does not apply when worktrees already present", () => {
  assertEquals(
    makeAction().applies(
      makeTicket({ phase: "new", worktrees: { "myorg/myrepo": { path: "/p", branch: "b" } } }),
    ),
    false,
  );
});

Deno.test("createWorktreeAction: does not apply to non-new phase", () => {
  assertEquals(makeAction().applies(makeTicket({ phase: "waiting-intake" })), false);
});

Deno.test("createWorktreeAction: no local repo → needs-attention", async () => {
  const written: string[] = [];
  const result = await makeAction({
    findLocalRepo: async () => null,
    writeTicket: async (_dir, t) => { written.push(t.phase); },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "needs-attention");
  assertEquals(written, ["needs-attention"]);
});

Deno.test("createWorktreeAction: createWorktree throws → needs-attention", async () => {
  const written: string[] = [];
  const result = await makeAction({
    findLocalRepo: async () => "/code/myrepo",
    createWorktree: async () => { throw new Error("git failed"); },
    writeTicket: async (_dir, t) => { written.push(t.phase); },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "needs-attention");
  assertEquals(written, ["needs-attention"]);
});

Deno.test("createWorktreeAction: success → worktrees populated, phase stays new", async () => {
  const written: TicketState[] = [];
  const result = await makeAction({
    findLocalRepo: async () => "/code/myrepo",
    createWorktree: async () => ({ path: "/wt/myorg/myrepo", branch: "gh-1" }),
    writeTicket: async (_dir, t) => { written.push(t); },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "new");
  assertEquals(result?.worktrees, { "myorg/myrepo": { path: "/wt/myorg/myrepo", branch: "gh-1" } });
  assertEquals(written.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
deno test --allow-all src/tick-actions/create-worktree_test.ts
```

Expected: FAIL — `Cannot resolve module './create-worktree.ts'`

- [ ] **Step 3: Implement `createWorktreeAction`**

Create `src/tick-actions/create-worktree.ts`:

```ts
import type { TickAction } from "./types.ts";
import type { TicketState, WorktreeInfo } from "../state/types.ts";
import { extractGitHubSlug } from "../worktree.ts";

export interface CreateWorktreeDeps {
  roots: string[];
  findLocalRepo: (roots: string[], slug: string) => Promise<string | null>;
  createWorktree: (repoPath: string, ticketId: string, slug: string) => Promise<WorktreeInfo>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
}

export function createWorktreeAction(deps: CreateWorktreeDeps): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return ticket.phase === "new" && Object.keys(ticket.worktrees).length === 0;
    },
    async run(ticket: TicketState, stateDir: string): Promise<TicketState | null> {
      const now = new Date().toISOString();
      const slug = extractGitHubSlug(ticket.url);
      const repoPath = await deps.findLocalRepo(deps.roots, slug);
      if (!repoPath) {
        const updated = { ...ticket, phase: "needs-attention" as const, updated: now };
        await deps.writeTicket(stateDir, updated);
        return updated;
      }
      try {
        const wt = await deps.createWorktree(repoPath, ticket.id, slug);
        const updated = { ...ticket, worktrees: { [slug]: wt }, updated: now };
        await deps.writeTicket(stateDir, updated);
        return updated;
      } catch {
        const updated = { ...ticket, phase: "needs-attention" as const, updated: now };
        await deps.writeTicket(stateDir, updated);
        return updated;
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
deno test --allow-all src/tick-actions/create-worktree_test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tick-actions/create-worktree.ts src/tick-actions/create-worktree_test.ts
git commit -m "feat: add createWorktreeAction"
```

---

### Task 4: Refactor `tick.ts` to two-pass loop

**Files:**
- Modify: `src/tick.ts`

**Interfaces:**
- Consumes: `createWorktreeAction` from `./tick-actions/create-worktree.ts` (Task 3); `TickAction` from `./tick-actions/types.ts` (Task 2)
- Produces: Two-pass tick loop — consumed by Task 6

- [ ] **Step 1: Update imports**

In `src/tick.ts`, replace:

```ts
import { extractGitHubSlug, findLocalRepo, createWorktree } from "./worktree.ts";
```

With:

```ts
import { findLocalRepo, createWorktree } from "./worktree.ts";
import { createWorktreeAction } from "./tick-actions/create-worktree.ts";
import type { TickAction } from "./tick-actions/types.ts";
```

- [ ] **Step 2: Replace the advance-tickets section with two-pass loop**

In `src/tick.ts`, replace everything from `// Advance tickets` through the closing `}` of the `for (let ticket of tickets)` loop with:

```ts
    // Advance tickets
    const maxRunning = config.tick.concurrency;
    const ids = await listTickets(stateDir);
    const tickets = await Promise.all(ids.map((id) => readTicket(stateDir, id)));

    const tickActions: TickAction[] = [
      createWorktreeAction({
        roots: config.codebase.roots.map(expandHome),
        findLocalRepo,
        createWorktree,
        writeTicket,
      }),
    ];

    // Action pass
    const processedTickets = [...tickets];
    for (let i = 0; i < processedTickets.length; i++) {
      for (const action of tickActions) {
        if (action.applies(processedTickets[i])) {
          const updated = await action.run(processedTickets[i], stateDir);
          if (updated !== null) processedTickets[i] = updated;
        }
      }
    }

    // Advance pass
    let running = processedTickets.filter((t) => t.phase.startsWith("running-")).length;

    for (const ticket of processedTickets) {
      if (["needs-attention", "done", "waiting-merge"].includes(ticket.phase)) continue;

      const willSpawn = ticket.phase === "new" ||
        (ticket.phase.startsWith("waiting-") && ticket.phase !== "waiting-diff" && ticket.approved);
      if (willSpawn && running >= maxRunning) continue;
      if (willSpawn) running++;

      await advancePhase(ticket, stateDir, {
        spawn: async (opts) =>
          spawnPhase({
            ticketDir: opts.ticketDir,
            prompt: opts.prompt,
            scopeDirs: opts.scope.map(expandHome),
            outputFile: outputFileForPhase(opts.phase),
            githubToken: token,
            anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
            worktrees: opts.worktrees,
          }),
        isPidAlive: defaultIsPidAlive,
        writeTicket,
        writePhaseOutput,
      });
    }
```

- [ ] **Step 3: Run all tests**

```bash
deno task test
```

Expected: all existing tests pass. `advancePhase` tests in `tick_test.ts` are unaffected since `advancePhase` itself is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/tick.ts
git commit -m "refactor: extract worktree creation to TickAction, two-pass tick loop"
```

---

### Task 5: Create `checkMergedPRAction`

**Files:**
- Create: `src/tick-actions/check-merged-pr.ts`
- Create: `src/tick-actions/check-merged-pr_test.ts`

**Interfaces:**
- Consumes: `TickAction` from `./types.ts`; `TicketState`, `WorktreeInfo` from `../state/types.ts`
- Produces: `checkMergedPRAction(deps: CheckMergedPRDeps): TickAction` — consumed by Task 6

`CheckMergedPRDeps`:
```ts
interface CheckMergedPRDeps {
  isPRMerged: (prUrl: string) => Promise<boolean>;
  cleanupWorktree: (wt: WorktreeInfo) => Promise<void>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
}
```

`cleanupWorktree` is responsible for both `git worktree remove` and `git branch -d`. Combining them into one dep avoids ordering problems (the worktree path must be reachable before the worktree is removed).

- [ ] **Step 1: Write failing tests**

Create `src/tick-actions/check-merged-pr_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { checkMergedPRAction } from "./check-merged-pr.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-42",
    provider: "github",
    title: "T",
    url: "https://github.com/myorg/myrepo/issues/42",
    phase: "waiting-merge",
    approved: false,
    scope: [],
    worktrees: { "myorg/myrepo": { path: "/wt/myorg/myrepo", branch: "gh-42" } },
    prUrl: "https://github.com/myorg/myrepo/pull/99",
    created: "2026-06-23T00:00:00Z",
    updated: "2026-06-23T00:00:00Z",
    body: "",
    ...overrides,
  };
}

function makeAction(overrides: Partial<Parameters<typeof checkMergedPRAction>[0]> = {}) {
  return checkMergedPRAction({
    isPRMerged: async () => false,
    cleanupWorktree: async () => {},
    writeTicket: async () => {},
    ...overrides,
  });
}

Deno.test("checkMergedPRAction: applies when waiting-merge with prUrl", () => {
  assertEquals(makeAction().applies(makeTicket()), true);
});

Deno.test("checkMergedPRAction: does not apply when prUrl absent", () => {
  assertEquals(makeAction().applies(makeTicket({ prUrl: undefined })), false);
});

Deno.test("checkMergedPRAction: does not apply when not waiting-merge", () => {
  assertEquals(makeAction().applies(makeTicket({ phase: "waiting-diff" })), false);
});

Deno.test("checkMergedPRAction: PR not merged → null, no cleanup", async () => {
  const cleanups: string[] = [];
  const result = await makeAction({
    isPRMerged: async () => false,
    cleanupWorktree: async (wt) => { cleanups.push(wt.path); },
  }).run(makeTicket(), "/state");
  assertEquals(result, null);
  assertEquals(cleanups, []);
});

Deno.test("checkMergedPRAction: isPRMerged throws → null, no cleanup", async () => {
  const cleanups: string[] = [];
  const result = await makeAction({
    isPRMerged: async () => { throw new Error("network error"); },
    cleanupWorktree: async (wt) => { cleanups.push(wt.path); },
  }).run(makeTicket(), "/state");
  assertEquals(result, null);
  assertEquals(cleanups, []);
});

Deno.test("checkMergedPRAction: PR merged → done, cleanup called per worktree", async () => {
  const cleanups: string[] = [];
  const written: string[] = [];
  const result = await makeAction({
    isPRMerged: async () => true,
    cleanupWorktree: async (wt) => { cleanups.push(wt.path); },
    writeTicket: async (_dir, t) => { written.push(t.phase); },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "done");
  assertEquals(cleanups, ["/wt/myorg/myrepo"]);
  assertEquals(written, ["done"]);
});

Deno.test("checkMergedPRAction: cleanupWorktree throws → still done", async () => {
  const written: string[] = [];
  const result = await makeAction({
    isPRMerged: async () => true,
    cleanupWorktree: async () => { throw new Error("git failed"); },
    writeTicket: async (_dir, t) => { written.push(t.phase); },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "done");
  assertEquals(written, ["done"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
deno test --allow-all src/tick-actions/check-merged-pr_test.ts
```

Expected: FAIL — `Cannot resolve module './check-merged-pr.ts'`

- [ ] **Step 3: Implement `checkMergedPRAction`**

Create `src/tick-actions/check-merged-pr.ts`:

```ts
import type { TickAction } from "./types.ts";
import type { TicketState, WorktreeInfo } from "../state/types.ts";

export interface CheckMergedPRDeps {
  isPRMerged: (prUrl: string) => Promise<boolean>;
  cleanupWorktree: (wt: WorktreeInfo) => Promise<void>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
}

export function checkMergedPRAction(deps: CheckMergedPRDeps): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return ticket.phase === "waiting-merge" && ticket.prUrl !== undefined;
    },
    async run(ticket: TicketState, stateDir: string): Promise<TicketState | null> {
      let merged: boolean;
      try {
        merged = await deps.isPRMerged(ticket.prUrl!);
      } catch (e) {
        console.error(`checkMergedPR: GitHub API error for ${ticket.id}:`, e);
        return null;
      }

      if (!merged) return null;

      const now = new Date().toISOString();
      for (const wt of Object.values(ticket.worktrees)) {
        try {
          await deps.cleanupWorktree(wt);
        } catch (e) {
          console.error(`checkMergedPR: cleanup failed for ${ticket.id}:`, e);
        }
      }

      const updated = { ...ticket, phase: "done" as const, updated: now };
      await deps.writeTicket(stateDir, updated);
      return updated;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
deno test --allow-all src/tick-actions/check-merged-pr_test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tick-actions/check-merged-pr.ts src/tick-actions/check-merged-pr_test.ts
git commit -m "feat: add checkMergedPRAction"
```

---

### Task 6: Wire `checkMergedPRAction` into `tick.ts`

**Files:**
- Modify: `src/tick.ts`

**Interfaces:**
- Consumes: `checkMergedPRAction` from `./tick-actions/check-merged-pr.ts` (Task 5); `WorktreeInfo` from `./state/types.ts`

- [ ] **Step 1: Add import**

In `src/tick.ts`, add to the existing tick-actions imports:

```ts
import { checkMergedPRAction } from "./tick-actions/check-merged-pr.ts";
```

The full tick-actions import block becomes:

```ts
import { createWorktreeAction } from "./tick-actions/create-worktree.ts";
import { checkMergedPRAction } from "./tick-actions/check-merged-pr.ts";
import type { TickAction } from "./tick-actions/types.ts";
```

- [ ] **Step 2: Add `checkMergedPRAction` to the `tickActions` array**

Replace the `tickActions` array in `tick()` with:

```ts
    const tickActions: TickAction[] = [
      createWorktreeAction({
        roots: config.codebase.roots.map(expandHome),
        findLocalRepo,
        createWorktree,
        writeTicket,
      }),
      checkMergedPRAction({
        isPRMerged: async (prUrl: string) => {
          const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
          if (!match) throw new Error(`Cannot parse PR URL: ${prUrl}`);
          const [, slug, number] = match;
          const res = await fetch(
            `https://api.github.com/repos/${slug}/pulls/${number}/merge`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
              },
            },
          );
          if (res.status === 204) return true;
          if (res.status === 404) return false;
          throw new Error(`Unexpected GitHub API status: ${res.status} for ${prUrl}`);
        },
        cleanupWorktree: async (wt) => {
          const result = await new Deno.Command("git", {
            args: ["rev-parse", "--git-common-dir"],
            cwd: wt.path,
          }).output();
          const gitDir = new TextDecoder().decode(result.stdout).trim();
          const mainRepoPath = gitDir.replace(/[/\\]\.git$/, "");
          await new Deno.Command("git", {
            args: ["worktree", "remove", wt.path],
            cwd: mainRepoPath,
          }).output();
          await new Deno.Command("git", {
            args: ["branch", "-d", wt.branch],
            cwd: mainRepoPath,
          }).output();
        },
        writeTicket,
      }),
    ];
```

`cleanupWorktree` uses `git rev-parse --git-common-dir` (run from inside the linked worktree) to find the main repo's `.git` directory, then derives the main repo path by stripping the trailing `/.git`. Both git commands are then run from the main repo.

- [ ] **Step 3: Run all tests**

```bash
deno task test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/tick.ts
git commit -m "feat: wire checkMergedPRAction into tick loop"
```
