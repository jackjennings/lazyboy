# Worktree Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a git worktree for each ticket before intake runs, mount it read/write in the implementation phase VM, and persist worktree path and branch in `meta.md`.

**Architecture:** A new `src/worktree.ts` module handles git operations (find local repo by scanning `codebase.roots`, create worktree). `tick()` performs worktree creation before calling `advancePhase` for new tickets and moves tickets with no discoverable local repo straight to `needs-attention`. `advancePhase` passes `ticket.worktrees` to `deps.spawn` for the implementation phase only; all other phases receive `{}`. `run-phase.ts` mounts each worktree at `/workspace/<org>/<repo>`.

**Tech Stack:** Deno, TypeScript, git CLI (via `Deno.Command`), gray-matter (YAML frontmatter), gondolin `RealFSProvider` (VM mounts).

## Global Constraints

- Branch name equals ticket ID (e.g. `gh-42`) — no prefix
- Worktree path on disk: `~/.lazyboy/worktrees/<ticket-id>/<org>/<repo>` (e.g. `~/.lazyboy/worktrees/gh-42/jackjennings/lazyboy`)
- VM mount path: `/workspace/<org>/<repo>` (e.g. `/workspace/jackjennings/lazyboy`)
- Base branch for all worktrees: `main` (hardcoded)
- `worktrees` on `TicketState` is always present, never optional; defaults to `{}`
- `WorktreeInfo` is defined in `src/state/types.ts` — import it from there everywhere
- `codebase.roots` in config: already-expanded paths (call `expandHome` after loading)
- Test command for a single file: `deno test --allow-all src/path/to/test.ts`
- Test command for all: `deno task test`

---

### Task 1: State layer — types, store, and config

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/store.ts`
- Modify: `src/config.ts`
- Create: `src/state/store_test.ts`
- Modify: `src/config_test.ts`

**Interfaces:**
- Produces:
  - `WorktreeInfo` — `{ path: string; branch: string }` exported from `src/state/types.ts`
  - `TicketState.worktrees: Record<string, WorktreeInfo>` — always present
  - `Config.codebase: { roots: string[] }` — defaults to `[]`

- [ ] **Step 1: Write failing store tests**

Create `src/state/store_test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert";
import { join } from "@std/path";
import { readTicket, writeTicket } from "./store.ts";
import type { TicketState } from "./types.ts";

Deno.test("readTicket: parses worktrees from frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-42");
  await Deno.mkdir(ticketDir);
  await Deno.writeTextFile(join(ticketDir, "meta.md"), `---
id: gh-42
provider: github
title: Test
url: https://github.com/jackjennings/lazyboy/issues/42
phase: waiting-intake
approved: false
scope: []
created: "2026-06-22T00:00:00Z"
updated: "2026-06-22T00:00:00Z"
worktrees:
  jackjennings/lazyboy:
    path: /home/user/.lazyboy/worktrees/gh-42/jackjennings/lazyboy
    branch: gh-42
---

body
`);
  const ticket = await readTicket(dir, "gh-42");
  assertEquals(ticket.worktrees, {
    "jackjennings/lazyboy": {
      path: "/home/user/.lazyboy/worktrees/gh-42/jackjennings/lazyboy",
      branch: "gh-42",
    },
  });
  await Deno.remove(dir, { recursive: true });
});

Deno.test("readTicket: defaults worktrees to {} when field absent", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir);
  await Deno.writeTextFile(join(ticketDir, "meta.md"), `---
id: gh-1
provider: github
title: Test
url: https://github.com/jackjennings/lazyboy/issues/1
phase: new
approved: false
scope: []
created: "2026-06-22T00:00:00Z"
updated: "2026-06-22T00:00:00Z"
---

body
`);
  const ticket = await readTicket(dir, "gh-1");
  assertEquals(ticket.worktrees, {});
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket: round-trips worktrees through meta.md", async () => {
  const dir = await Deno.makeTempDir();
  const ticket: TicketState = {
    id: "gh-42",
    provider: "github",
    title: "T",
    url: "https://github.com/jackjennings/lazyboy/issues/42",
    phase: "new",
    approved: false,
    scope: [],
    worktrees: {
      "jackjennings/lazyboy": {
        path: "/tmp/.lazyboy/worktrees/gh-42/jackjennings/lazyboy",
        branch: "gh-42",
      },
    },
    created: "2026-06-22T00:00:00Z",
    updated: "2026-06-22T00:00:00Z",
    body: "",
  };
  await writeTicket(dir, ticket);
  const read = await readTicket(dir, "gh-42");
  assertEquals(read.worktrees["jackjennings/lazyboy"].branch, "gh-42");
  assertEquals(read.worktrees["jackjennings/lazyboy"].path, "/tmp/.lazyboy/worktrees/gh-42/jackjennings/lazyboy");
  await Deno.remove(dir, { recursive: true });
});
```

- [ ] **Step 2: Write failing config test**

Add to `src/config_test.ts`:

```typescript
Deno.test("loadConfig parses codebase.roots", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "config.toml"), `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2

[codebase]
roots = ["~/code/myorg", "~/code/anotherg"]
`);
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.codebase.roots, ["~/code/myorg", "~/code/anotherg"]);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig defaults codebase.roots to [] when absent", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "config.toml"), `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2
`);
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.codebase.roots, []);
  await Deno.remove(dir, { recursive: true });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
deno test --allow-all src/state/store_test.ts src/config_test.ts
```

Expected: type errors or runtime failures (fields don't exist yet).

- [ ] **Step 4: Add `WorktreeInfo` and update `TicketState` and `Config` in `src/state/types.ts`**

Add `WorktreeInfo` before `TicketState`. Add `worktrees` field to `TicketState`. Add `codebase` field to `Config`:

```typescript
export interface WorktreeInfo {
  path: string;
  branch: string;
}

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
  created: string;
  updated: string;
  body: string;
}

export interface Config {
  github: { repos: string[] };
  state: { dir: string };
  tick: { concurrency: number };
  codebase: { roots: string[] };
}
```

- [ ] **Step 5: Update `src/state/store.ts` to read and write `worktrees`**

In `readTicket`, add worktrees parsing after existing `data` destructuring. The new lines read the `worktrees` field (which gray-matter parses as a plain object) and default to `{}`:

```typescript
export async function readTicket(stateDir: string, id: string): Promise<TicketState> {
  const metaPath = join(stateDir, id, "meta.md");
  const raw = await Deno.readTextFile(metaPath);
  const { data, content } = matter(raw);

  const worktreesRaw = data.worktrees as Record<string, { path: string; branch: string }> | undefined;
  const worktrees: Record<string, WorktreeInfo> = {};
  if (worktreesRaw) {
    for (const [slug, info] of Object.entries(worktreesRaw)) {
      worktrees[slug] = { path: info.path, branch: info.branch };
    }
  }

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
    created: data.created,
    updated: data.updated,
    body: content.trim(),
  };
}
```

Add `WorktreeInfo` to the import from `./types.ts`:

```typescript
import type { TicketState, Phase, WorktreeInfo } from "./types.ts";
```

In `writeTicket`, add `worktrees` to the frontmatter object. Replace the existing `frontmatter` block:

```typescript
export async function writeTicket(stateDir: string, ticket: TicketState): Promise<void> {
  const dir = join(stateDir, ticket.id);
  await Deno.mkdir(dir, { recursive: true });
  const frontmatter: Record<string, unknown> = {
    id: ticket.id,
    provider: ticket.provider,
    title: ticket.title,
    url: ticket.url,
    phase: ticket.phase,
    approved: ticket.approved,
    scope: ticket.scope,
    worktrees: ticket.worktrees,
    created: ticket.created,
    updated: ticket.updated,
  };
  if (ticket.pid !== undefined) frontmatter.pid = ticket.pid;
  const raw = matter.stringify(ticket.body, frontmatter);
  await Deno.writeTextFile(join(dir, "meta.md"), raw);
}
```

- [ ] **Step 6: Update `src/config.ts` to parse `codebase.roots`**

Replace the return statement in `loadConfig`:

```typescript
export async function loadConfig(path?: string): Promise<Config> {
  const configPath = path ?? join(Deno.env.get("HOME")!, ".config", "lazyboy", "config.toml");
  const raw = await Deno.readTextFile(configPath);
  const parsed = parse(raw) as Record<string, unknown>;
  const codebaseRaw = parsed.codebase as Record<string, unknown> | undefined;
  return {
    github: { repos: (parsed.github as Record<string, unknown>).repos as string[] },
    state: { dir: expandHome((parsed.state as Record<string, unknown>).dir as string) },
    tick: { concurrency: ((parsed.tick as Record<string, unknown>).concurrency as number) ?? 1 },
    codebase: { roots: (codebaseRaw?.roots as string[]) ?? [] },
  };
}
```

- [ ] **Step 7: Fix the `makeTicket` helper in `src/tick_test.ts`**

Add `worktrees: {}` to the return value of `makeTicket`:

```typescript
function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1", provider: "github", title: "T", url: "u",
    phase: "new", approved: false, scope: [], worktrees: {},
    created: "2026-06-15T00:00:00Z", updated: "2026-06-15T00:00:00Z", body: "",
    ...overrides,
  };
}
```

- [ ] **Step 8: Run all tests**

```bash
deno task test
```

Expected: all existing tests pass; new store and config tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/state/types.ts src/state/store.ts src/state/store_test.ts src/config.ts src/config_test.ts src/tick_test.ts
git commit -m "feat: add WorktreeInfo type and worktrees field to TicketState"
```

---

### Task 2: `src/worktree.ts` — git worktree operations

**Files:**
- Create: `src/worktree.ts`
- Create: `src/worktree_test.ts`

**Interfaces:**
- Consumes: `WorktreeInfo` from `src/state/types.ts`; `expandHome` from `src/config.ts`
- Produces:
  - `extractGitHubSlug(url: string): string`
  - `findLocalRepo(roots: string[], slug: string): Promise<string | null>`
  - `createWorktree(repoPath: string, ticketId: string, slug: string): Promise<WorktreeInfo>`

- [ ] **Step 1: Write failing tests**

Create `src/worktree_test.ts`:

```typescript
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { join } from "@std/path";
import { extractGitHubSlug, findLocalRepo, createWorktree } from "./worktree.ts";

// ── extractGitHubSlug ────────────────────────────────────────────────────────

Deno.test("extractGitHubSlug: extracts slug from issue URL", () => {
  assertEquals(
    extractGitHubSlug("https://github.com/jackjennings/lazyboy/issues/42"),
    "jackjennings/lazyboy",
  );
});

Deno.test("extractGitHubSlug: works with PR URLs", () => {
  assertEquals(
    extractGitHubSlug("https://github.com/myorg/myrepo/pull/7"),
    "myorg/myrepo",
  );
});

Deno.test("extractGitHubSlug: throws on non-GitHub URL", () => {
  assertThrows(
    () => extractGitHubSlug("https://example.com/foo"),
    Error,
    "Cannot extract GitHub slug",
  );
});

// ── findLocalRepo ────────────────────────────────────────────────────────────

Deno.test("findLocalRepo: finds repo by matching origin remote", async () => {
  const root = await Deno.makeTempDir();
  const repoDir = join(root, "lazyboy");
  await Deno.mkdir(repoDir);
  await new Deno.Command("git", { args: ["init"], cwd: repoDir }).output();
  await new Deno.Command("git", {
    args: ["remote", "add", "origin", "https://github.com/jackjennings/lazyboy.git"],
    cwd: repoDir,
  }).output();

  const result = await findLocalRepo([root], "jackjennings/lazyboy");
  assertEquals(result, repoDir);

  await Deno.remove(root, { recursive: true });
});

Deno.test("findLocalRepo: returns null when no repo matches", async () => {
  const root = await Deno.makeTempDir();
  const result = await findLocalRepo([root], "jackjennings/lazyboy");
  assertEquals(result, null);
  await Deno.remove(root, { recursive: true });
});

Deno.test("findLocalRepo: skips non-git directories", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "notarepo"));
  const result = await findLocalRepo([root], "jackjennings/lazyboy");
  assertEquals(result, null);
  await Deno.remove(root, { recursive: true });
});

Deno.test("findLocalRepo: returns null for nonexistent root", async () => {
  const result = await findLocalRepo(["/nonexistent/path"], "jackjennings/lazyboy");
  assertEquals(result, null);
});

// ── createWorktree ───────────────────────────────────────────────────────────

Deno.test("createWorktree: creates branch and worktree directory", async () => {
  const repoDir = await Deno.makeTempDir();
  await new Deno.Command("git", { args: ["init"], cwd: repoDir }).output();
  await new Deno.Command("git", {
    args: ["config", "user.email", "test@test.com"],
    cwd: repoDir,
  }).output();
  await new Deno.Command("git", {
    args: ["config", "user.name", "Test"],
    cwd: repoDir,
  }).output();
  await Deno.writeTextFile(join(repoDir, "README.md"), "test");
  await new Deno.Command("git", { args: ["add", "."], cwd: repoDir }).output();
  await new Deno.Command("git", {
    args: ["commit", "-m", "init"],
    cwd: repoDir,
  }).output();
  await new Deno.Command("git", {
    args: ["branch", "-m", "main"],
    cwd: repoDir,
  }).output();

  const info = await createWorktree(repoDir, "gh-42", "jackjennings/lazyboy");

  const stat = await Deno.stat(info.path);
  assertEquals(stat.isDirectory, true);
  assertEquals(info.branch, "gh-42");
  assertEquals(info.path.endsWith("jackjennings/lazyboy"), true);

  // cleanup
  await new Deno.Command("git", {
    args: ["worktree", "remove", "--force", info.path],
    cwd: repoDir,
  }).output();
  await Deno.remove(repoDir, { recursive: true });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
deno test --allow-all src/worktree_test.ts
```

Expected: error — module `./worktree.ts` not found.

- [ ] **Step 3: Create `src/worktree.ts`**

```typescript
import { join } from "@std/path";
import type { WorktreeInfo } from "./state/types.ts";

export function extractGitHubSlug(url: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) throw new Error(`Cannot extract GitHub slug from URL: ${url}`);
  return match[1];
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string }> {
  const result = await new Deno.Command("git", { args, cwd }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout).trim(),
  };
}

export async function findLocalRepo(
  roots: string[],
  slug: string,
): Promise<string | null> {
  for (const root of roots) {
    try {
      for await (const entry of Deno.readDir(root)) {
        if (!entry.isDirectory) continue;
        const candidatePath = join(root, entry.name);
        const { code, stdout } = await runGit(
          ["remote", "get-url", "origin"],
          candidatePath,
        );
        if (code === 0 && stdout.includes(slug)) return candidatePath;
      }
    } catch {
      // root doesn't exist or isn't readable — skip
    }
  }
  return null;
}

export async function createWorktree(
  repoPath: string,
  ticketId: string,
  slug: string,
): Promise<WorktreeInfo> {
  const home = Deno.env.get("HOME")!;
  const [org, repo] = slug.split("/");
  const worktreePath = join(home, ".lazyboy", "worktrees", ticketId, org, repo);
  await Deno.mkdir(join(home, ".lazyboy", "worktrees", ticketId, org), { recursive: true });

  const { code } = await runGit(
    ["worktree", "add", "-b", ticketId, worktreePath, "main"],
    repoPath,
  );
  if (code !== 0) {
    throw new Error(`git worktree add failed for ticket ${ticketId} in ${repoPath}`);
  }

  return { path: worktreePath, branch: ticketId };
}
```

- [ ] **Step 4: Run tests**

```bash
deno test --allow-all src/worktree_test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
deno task test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/worktree.ts src/worktree_test.ts
git commit -m "feat: add worktree module with findLocalRepo and createWorktree"
```

---

### Task 3: `advancePhase` — forward worktrees to spawn

**Files:**
- Modify: `src/tick.ts` (TickDeps interface + advancePhase spawn calls only)
- Modify: `src/tick_test.ts`

**Interfaces:**
- Consumes: `WorktreeInfo` from `src/state/types.ts`
- Produces: updated `TickDeps.spawn` opts shape — adds `worktrees: Record<string, WorktreeInfo>`

- [ ] **Step 1: Write failing tests**

Add to `src/tick_test.ts` (import `WorktreeInfo` from `./state/types.ts` if needed — the type is needed in the test assertions):

```typescript
Deno.test("advancePhase: implementation phase receives ticket worktrees", async () => {
  const spawnedWorktrees: Record<string, unknown>[] = [];
  const ticket = makeTicket({
    phase: "waiting-plan",
    approved: true,
    worktrees: { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" } },
  });
  await advancePhase(ticket, "/state", {
    spawn: async (opts) => {
      spawnedWorktrees.push(opts.worktrees);
      return 1;
    },
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
  });
  assertEquals(spawnedWorktrees, [
    { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" } },
  ]);
});

Deno.test("advancePhase: non-implementation phases receive empty worktrees", async () => {
  const spawnedWorktrees: Record<string, unknown>[] = [];
  const ticket = makeTicket({
    phase: "waiting-intake",
    approved: true,
    worktrees: { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" } },
  });
  await advancePhase(ticket, "/state", {
    spawn: async (opts) => {
      spawnedWorktrees.push(opts.worktrees);
      return 1;
    },
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
  });
  assertEquals(spawnedWorktrees, [{}]);
});

Deno.test("advancePhase: new ticket spawn receives empty worktrees", async () => {
  const spawnedWorktrees: Record<string, unknown>[] = [];
  const ticket = makeTicket({ phase: "new" });
  await advancePhase(ticket, "/state", {
    spawn: async (opts) => {
      spawnedWorktrees.push(opts.worktrees);
      return 123;
    },
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
  });
  assertEquals(spawnedWorktrees, [{}]);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
deno test --allow-all src/tick_test.ts
```

Expected: TypeScript error — `opts.worktrees` does not exist.

- [ ] **Step 3: Update `TickDeps` and `advancePhase` in `src/tick.ts`**

Add `WorktreeInfo` to imports at the top of `src/tick.ts`:

```typescript
import type { TicketState, Phase, WorktreeInfo } from "./state/types.ts";
```

Update `TickDeps.spawn` signature:

```typescript
export interface TickDeps {
  spawn: (opts: {
    phase: ActivePhase;
    ticketDir: string;
    prompt: string;
    scope: string[];
    worktrees: Record<string, WorktreeInfo>;
  }) => Promise<number>;
  isPidAlive: (pid: number) => boolean;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  writePhaseOutput: (stateDir: string, id: string, file: string, content: string) => Promise<void>;
}
```

Update the `"new"` branch in `advancePhase` to pass `worktrees: {}`:

```typescript
if (ticket.phase === "new") {
  const prompt = await loadPrompt("intake");
  const pid = await deps.spawn({
    phase: "intake",
    ticketDir: join(stateDir, ticket.id),
    prompt,
    scope: [],
    worktrees: {},
  });
  await deps.writeTicket(stateDir, { ...ticket, phase: "running-intake", pid, updated: now });
  return;
}
```

Update the `waitingPhaseToActive` branch to pass `worktrees` — implementation phase gets ticket's worktrees, all others get `{}`:

```typescript
const activePhase = waitingPhaseToActive(ticket.phase);
if (activePhase !== null && ticket.approved) {
  const next = nextPhase(activePhase);
  if (next === "done") {
    await deps.writeTicket(stateDir, { ...ticket, phase: "waiting-merge", approved: false, updated: now });
    return;
  }
  const prompt = await loadPrompt(next);
  const pid = await deps.spawn({
    phase: next,
    ticketDir: join(stateDir, ticket.id),
    prompt,
    scope: ticket.scope,
    worktrees: next === "implementation" ? ticket.worktrees : {},
  });
  await deps.writeTicket(stateDir, { ...ticket, phase: `running-${next}` as Phase, approved: false, pid, updated: now });
  return;
}
```

- [ ] **Step 4: Run tests**

```bash
deno test --allow-all src/tick_test.ts
```

Expected: all tests pass, including the three new ones.

- [ ] **Step 5: Run full test suite**

```bash
deno task test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tick.ts src/tick_test.ts
git commit -m "feat: forward worktrees to spawn opts in advancePhase"
```

---

### Task 4: Tick pre-advance — create worktree before intake

**Files:**
- Modify: `src/tick.ts` (tick function only)

No new unit tests here — the worktree operations are already tested in `worktree_test.ts` and `advancePhase` forwarding is tested in `tick_test.ts`. Verification is via manual run (see Step 4).

**Interfaces:**
- Consumes: `extractGitHubSlug`, `findLocalRepo`, `createWorktree` from `./worktree.ts`

- [ ] **Step 1: Add imports to `src/tick.ts`**

Add to the import block at the top of `src/tick.ts`:

```typescript
import { extractGitHubSlug, findLocalRepo, createWorktree } from "./worktree.ts";
```

- [ ] **Step 2: Replace the ticket loop in `tick()` with the pre-advance worktree step**

Find the existing `for` loop in `tick()`:

```typescript
for (const ticket of tickets) {
  if (["needs-attention", "done", "waiting-merge"].includes(ticket.phase)) continue;
  const willSpawn = ticket.phase === "new" || ...
```

Replace `const ticket` with `let ticket` and add the pre-advance block after the early-continue check:

```typescript
for (let ticket of tickets) {
  if (["needs-attention", "done", "waiting-merge"].includes(ticket.phase)) continue;

  if (ticket.phase === "new") {
    const slug = extractGitHubSlug(ticket.url);
    const repoPath = await findLocalRepo(
      config.codebase.roots.map(expandHome),
      slug,
    );
    if (!repoPath) {
      await writeTicket(stateDir, {
        ...ticket,
        phase: "needs-attention",
        updated: new Date().toISOString(),
      });
      continue;
    }
    const wt = await createWorktree(repoPath, ticket.id, slug);
    ticket = { ...ticket, worktrees: { [slug]: wt } };
    await writeTicket(stateDir, ticket);
  }

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

- [ ] **Step 3: Run full test suite**

```bash
deno task test
```

Expected: all tests pass. The `spawnPhase` call now has a `worktrees` argument that TypeScript will flag until Task 5 adds it to `ExecutorOptions` — if TypeScript errors appear here, proceed to Task 5 immediately and return to verify.

- [ ] **Step 4: Commit**

```bash
git add src/tick.ts
git commit -m "feat: create worktree before intake in tick pre-advance step"
```

---

### Task 5: Executor and run-phase — pass and mount worktrees in VM

**Files:**
- Modify: `src/executor.ts`
- Modify: `src/run-phase.ts`

**Interfaces:**
- Consumes: `WorktreeInfo` from `src/state/types.ts`
- Produces: `--worktrees <json>` CLI arg parsed by `run-phase.ts`; worktrees mounted at `/workspace/<org>/<repo>` in the VM

- [ ] **Step 1: Update `ExecutorOptions` in `src/executor.ts`**

Add `WorktreeInfo` import and add `worktrees` field:

```typescript
import type { WorktreeInfo } from "./state/types.ts";

export interface ExecutorOptions {
  ticketDir: string;
  prompt: string;
  scopeDirs: string[];
  outputFile: string;
  githubToken: string;
  anthropicApiKey: string;
  worktrees: Record<string, WorktreeInfo>;
}
```

- [ ] **Step 2: Pass `--worktrees` arg in `spawnPhase`**

In `spawnPhase`, add `"--worktrees", JSON.stringify(opts.worktrees)` to the args array:

```typescript
export function spawnPhase(opts: ExecutorOptions): number {
  const runPhaseScript = new URL("./run-phase.ts", import.meta.url).pathname;
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run", "--allow-all", runPhaseScript,
      "--ticket-dir", opts.ticketDir,
      "--output-file", opts.outputFile,
      "--scope", opts.scopeDirs.join(","),
      "--prompt", opts.prompt,
      "--worktrees", JSON.stringify(opts.worktrees),
    ],
    env: {
      GITHUB_TOKEN: opts.githubToken,
      ANTHROPIC_API_KEY: opts.anthropicApiKey,
    },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  const child = cmd.spawn();
  return child.pid;
}
```

- [ ] **Step 3: Parse `--worktrees` and mount in `src/run-phase.ts`**

Add `"worktrees"` to the `string` list in `parseArgs`, then parse the JSON and add mounts. Replace the existing `parseArgs` call and mount construction:

```typescript
const args = parseArgs(Deno.args, {
  string: ["ticket-dir", "output-file", "scope", "prompt", "worktrees"],
});

const ticketDir = args["ticket-dir"]!;
const outputFile = args["output-file"]!;
const scopeDirs = args["scope"] ? args["scope"].split(",").filter(Boolean) : [];
const prompt = args["prompt"]!;
const worktrees = args["worktrees"]
  ? JSON.parse(args["worktrees"]) as Record<string, { path: string; branch: string }>
  : {};
```

Then in the mounts block, add the worktree mounts after the existing scope mounts:

```typescript
const vfsMounts: Record<string, InstanceType<typeof RealFSProvider>> = {
  "/ticket": new RealFSProvider(ticketDir),
};
for (const dir of scopeDirs) {
  const guestPath = `/scope/${dir.split("/").pop()}`;
  vfsMounts[guestPath] = new RealFSProvider(dir);
}
for (const [slug, info] of Object.entries(worktrees)) {
  vfsMounts[`/workspace/${slug}`] = new RealFSProvider(info.path);
}
```

- [ ] **Step 4: Run full test suite**

```bash
deno task test
```

Expected: all tests pass (executor_test.ts tests `isPidAlive` only and is unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/executor.ts src/run-phase.ts
git commit -m "feat: pass worktrees to run-phase and mount at /workspace/<org>/<repo>"
```

---

### Task 6: Implementation prompt and README

**Files:**
- Modify: `src/phases/prompts/implementation.md`
- Modify: `README.md`

- [ ] **Step 1: Update `src/phases/prompts/implementation.md`**

Replace the current content with:

```markdown
You are the implementation agent for an automated development pipeline.

Read /ticket/meta.md, /ticket/spec.md, and /ticket/plan.md. Implement the plan
exactly as specified using TDD.

The repository worktree is mounted read/write at `/workspace/<org>/<repo>`. Find
the exact path by reading the `worktrees` field in `/ticket/meta.md` — the key is
`<org>/<repo>` (e.g. `jackjennings/lazyboy`) and the mount point is
`/workspace/<org>/<repo>`. All code changes go in the worktree. Do not write to
`/ticket` or `/scope` paths.

When done, output a summary of what was changed:

## Changes Made

List each file created or modified with a one-line description.

## Tests

Confirm all tests pass and show the test run output.

## Diff Summary

A brief description of the overall change suitable for a PR description.
```

- [ ] **Step 2: Update `README.md`**

Replace the SP2 section. Find:

```markdown
### Sub-project 2 — Worktree isolation
```

Replace the whole SP2 block with:

```markdown
### Sub-project 2 — Worktree isolation ✅

Before intake runs, `tick()` creates a dedicated git branch (`<ticket-id>`, e.g. `gh-42`) and a linked working tree (`git worktree add`) in `~/.lazyboy/worktrees/<ticket-id>/<org>/<repo>`. The branch and worktree path are stored in `meta.md` under `worktrees.<org>/<repo>`. The implementation phase VM mounts the worktree read/write at `/workspace/<org>/<repo>`. If no local clone of the repo is found by scanning `codebase.roots`, the ticket moves to `needs-attention` before intake.

Worktree removal (on merge or cleanup) is handled in SP3.

_Worktrees: `~/.lazyboy/worktrees/` · Branch: ticket ID · Base: `main`_
```

- [ ] **Step 3: Add two Opportunity entries to the Opportunities section of `README.md`**

Add before the closing `---` or at the end of the Opportunities list:

```markdown
- **Auto-clone missing repos:** when `tick()` cannot find a local clone of a ticket's repo by scanning `codebase.roots`, it currently moves the ticket to `needs-attention`. A future extension could attempt `git clone` into the first configured root, making the pipeline fully hands-off for first-time repos.

- **Hooks system for pre-advance lifecycle:** worktree creation is currently an inline conditional in `tick()`. As more pre-advance concerns accumulate (ceremonies, conflict checks, cleanup), a `runPreAdvance(ticket, config)` runner in `tick.ts` with registered hook functions would let each concern declare itself independently rather than growing the loop body. Pi's own hooks system (`tool_call`, `tool_result`, `before_agent_start`) is a reference point for this design.
```

- [ ] **Step 4: Run full test suite one final time**

```bash
deno task test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/prompts/implementation.md README.md
git commit -m "docs: update implementation prompt and README for SP2 worktree isolation"
```
