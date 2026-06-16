# lazyboy Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal end-to-end lazyboy automation loop: cron triggers tick, GitHub Issues are fetched, each ticket advances through intake → enrichment → spec → planning → implementation → merge via pi agent in a gondolin VM, pausing at each phase for human approval.

**Architecture:** A Deno CLI (`lazyboy`) with subcommands `tick`, `approve`, and `status`. State lives as plain-text markdown files with YAML frontmatter in `~/code/jackjennings/projects/`. Agent phases run asynchronously in gondolin micro-VMs; the tick loop checks PID liveness to detect completion.

**Tech Stack:** Deno, TypeScript, gondolin (`npm:@earendil-works/gondolin`), gray-matter (`npm:gray-matter`) for frontmatter, `jsr:@std/toml` for config, GitHub REST API via `fetch`.

---

## File Map

| File | Responsibility |
|---|---|
| `src/state/types.ts` | `Phase`, `TicketState`, `Config` types |
| `src/state/store.ts` | Read/write `meta.md` and phase output files; git commit |
| `src/providers/types.ts` | `Provider` interface, `WorkItem` type |
| `src/providers/github.ts` | GitHub Issues provider (fetch by assignee) |
| `src/executor.ts` | Spawn Deno subprocess (run-phase.ts), return PID |
| `src/run-phase.ts` | Subprocess entry: creates gondolin VM, runs pi, writes output |
| `src/phases/types.ts` | `PhaseRunner` type, phase → output file mapping |
| `src/phases/prompts/` | One `.md` prompt template per phase |
| `src/tick.ts` | Main tick loop |
| `src/index.ts` | CLI entrypoint (`tick`, `approve`, `status`) |
| `deno.json` | Tasks, imports, compiler options |
| `deno.lock` | Lockfile (committed) |

---

### Task 1: Initialize repo and deno.json

**Files:**
- Create: `~/code/jackjennings/lazyboy/deno.json`
- Create: `~/code/jackjennings/lazyboy/.gitignore`

- [ ] **Create repo**

```bash
mkdir -p ~/code/jackjennings/lazyboy
cd ~/code/jackjennings/lazyboy
git init
```

- [ ] **Create deno.json**

```json
{
  "tasks": {
    "start": "deno run --allow-all src/index.ts",
    "test": "deno test --allow-all src/"
  },
  "imports": {
    "gray-matter": "npm:gray-matter@4.0.3",
    "@std/toml": "jsr:@std/toml@^1.0.0",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@std/cli": "jsr:@std/cli@^1.0.0",
    "gondolin": "npm:@earendil-works/gondolin@latest"
  }
}
```

- [ ] **Create .gitignore**

```
.DS_Store
```

- [ ] **Lock dependencies**

```bash
cd ~/code/jackjennings/lazyboy
deno cache --lock=deno.lock src/index.ts 2>/dev/null || true
```

- [ ] **Initial commit**

```bash
cd ~/code/jackjennings/lazyboy
git add deno.json .gitignore
git commit -m "chore: initialize lazyboy repo"
```

---

### Task 2: Core types

**Files:**
- Create: `src/state/types.ts`
- Create: `src/providers/types.ts`
- Create: `src/phases/types.ts`

- [ ] **Create src/state/types.ts**

```typescript
export type Phase =
  | "new"
  | "running-intake" | "waiting-intake"
  | "running-enrichment" | "waiting-enrichment"
  | "running-spec" | "waiting-spec"
  | "running-plan" | "waiting-plan"
  | "running-implementation" | "waiting-diff"
  | "waiting-merge"
  | "done"
  | "needs-attention";

export interface TicketState {
  id: string;
  provider: string;
  title: string;
  url: string;
  phase: Phase;
  approved: boolean;
  scope: string[];
  pid?: number;
  created: string;
  updated: string;
  body: string;
}

export interface Config {
  github: { repos: string[] };
  state: { dir: string };
  tick: { concurrency: number };
}
```

- [ ] **Create src/providers/types.ts**

```typescript
export interface WorkItem {
  id: string;
  provider: string;
  title: string;
  description: string;
  url: string;
}

export interface Provider {
  fetchNew(knownIds: Set<string>): Promise<WorkItem[]>;
}
```

- [ ] **Create src/phases/types.ts**

```typescript
export type PhaseRunner = (ticketDir: string) => Promise<void>;

export const PHASE_OUTPUT_FILE: Record<string, string> = {
  intake: "intake.md",
  enrichment: "enrichment.md",
  spec: "spec.md",
  plan: "plan.md",
  implementation: "diff.md",
};

export const PHASE_SEQUENCE = [
  "intake",
  "enrichment",
  "spec",
  "plan",
  "implementation",
] as const;

export type ActivePhase = typeof PHASE_SEQUENCE[number];
```

- [ ] **Write tests**

Create `src/state/types_test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert";
import type { TicketState } from "./types.ts";

Deno.test("TicketState has required fields", () => {
  const t: TicketState = {
    id: "gh-1",
    provider: "github",
    title: "Test",
    url: "https://github.com/x/y/issues/1",
    phase: "new",
    approved: false,
    scope: [],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    body: "",
  };
  assertEquals(t.phase, "new");
  assertEquals(t.approved, false);
});
```

- [ ] **Run tests**

```bash
cd ~/code/jackjennings/lazyboy
deno test --allow-all src/state/types_test.ts
```

Expected: PASS

- [ ] **Commit**

```bash
git add src/
git commit -m "feat: add core types"
```

---

### Task 3: State store

**Files:**
- Create: `src/state/store.ts`
- Create: `src/state/store_test.ts`

- [ ] **Write failing tests**

Create `src/state/store_test.ts`:

```typescript
import { assertEquals, assertExists } from "jsr:@std/assert";
import { join } from "@std/path";
import { readTicket, writeTicket, listTickets, commitState } from "./store.ts";
import type { TicketState } from "./types.ts";

const TEST_DIR = await Deno.makeTempDir();

const sample: TicketState = {
  id: "gh-99",
  provider: "github",
  title: "Test ticket",
  url: "https://github.com/x/y/issues/99",
  phase: "new",
  approved: false,
  scope: [],
  created: "2026-06-15T00:00:00Z",
  updated: "2026-06-15T00:00:00Z",
  body: "Some description",
};

Deno.test("writeTicket creates meta.md with frontmatter", async () => {
  await writeTicket(TEST_DIR, sample);
  const meta = join(TEST_DIR, "gh-99", "meta.md");
  const text = await Deno.readTextFile(meta);
  assert(text.includes("id: gh-99"));
  assert(text.includes("phase: new"));
});

Deno.test("readTicket parses meta.md back", async () => {
  const t = await readTicket(TEST_DIR, "gh-99");
  assertEquals(t.id, "gh-99");
  assertEquals(t.phase, "new");
  assertEquals(t.body, "Some description");
});

Deno.test("listTickets returns all ticket IDs", async () => {
  const ids = await listTickets(TEST_DIR);
  assert(ids.includes("gh-99"));
});

function assert(v: boolean) { if (!v) throw new Error("assertion failed"); }
```

- [ ] **Run tests to confirm they fail**

```bash
cd ~/code/jackjennings/lazyboy
deno test --allow-all src/state/store_test.ts
```

Expected: FAIL — `store.ts` not found

- [ ] **Implement src/state/store.ts**

```typescript
import matter from "gray-matter";
import { join } from "@std/path";
import type { TicketState, Phase } from "./types.ts";

export async function readTicket(stateDir: string, id: string): Promise<TicketState> {
  const metaPath = join(stateDir, id, "meta.md");
  const raw = await Deno.readTextFile(metaPath);
  const { data, content } = matter(raw);
  return {
    id: data.id,
    provider: data.provider,
    title: data.title,
    url: data.url,
    phase: data.phase as Phase,
    approved: data.approved ?? false,
    scope: data.scope ?? [],
    pid: data.pid,
    created: data.created,
    updated: data.updated,
    body: content.trim(),
  };
}

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
    created: ticket.created,
    updated: ticket.updated,
  };
  if (ticket.pid !== undefined) frontmatter.pid = ticket.pid;
  const raw = matter.stringify(ticket.body, frontmatter);
  await Deno.writeTextFile(join(dir, "meta.md"), raw);
}

export async function writePhaseOutput(stateDir: string, id: string, filename: string, content: string): Promise<void> {
  await Deno.writeTextFile(join(stateDir, id, filename), content);
}

export async function readPhaseOutput(stateDir: string, id: string, filename: string): Promise<string> {
  return Deno.readTextFile(join(stateDir, id, filename));
}

export async function listTickets(stateDir: string): Promise<string[]> {
  const ids: string[] = [];
  for await (const entry of Deno.readDir(stateDir)) {
    if (entry.isDirectory) ids.push(entry.name);
  }
  return ids;
}

export async function commitState(stateDir: string, message: string): Promise<void> {
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: stateDir }).output();
  await run(["git", "add", "-A"]);
  const result = await run(["git", "commit", "-m", message]);
  // exit 1 with "nothing to commit" is fine
  if (result.code !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    if (!stderr.includes("nothing to commit") && !new TextDecoder().decode(result.stdout).includes("nothing to commit")) {
      throw new Error(`git commit failed: ${stderr}`);
    }
  }
}
```

- [ ] **Run tests**

```bash
cd ~/code/jackjennings/lazyboy
deno test --allow-all src/state/store_test.ts
```

Expected: PASS

- [ ] **Commit**

```bash
git add src/state/
git commit -m "feat: add state store"
```

---

### Task 4: Config loader

**Files:**
- Create: `src/config.ts`
- Create: `src/config_test.ts`

- [ ] **Write failing test**

Create `src/config_test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert";
import { loadConfig } from "./config.ts";
import { join } from "@std/path";

Deno.test("loadConfig parses toml", async () => {
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
  assertEquals(cfg.github.repos, ["jackjennings/lazyboy"]);
  assertEquals(cfg.tick.concurrency, 2);
});
```

- [ ] **Run to confirm fail**

```bash
deno test --allow-all src/config_test.ts
```

- [ ] **Implement src/config.ts**

```typescript
import { parse } from "@std/toml";
import { join } from "@std/path";
import type { Config } from "./state/types.ts";

export async function loadConfig(path?: string): Promise<Config> {
  const configPath = path ?? join(Deno.env.get("HOME")!, ".config", "lazyboy", "config.toml");
  const raw = await Deno.readTextFile(configPath);
  const parsed = parse(raw) as Record<string, unknown>;
  return {
    github: { repos: (parsed.github as Record<string, unknown>).repos as string[] },
    state: { dir: expandHome((parsed.state as Record<string, unknown>).dir as string) },
    tick: { concurrency: ((parsed.tick as Record<string, unknown>).concurrency as number) ?? 1 },
  };
}

export function expandHome(p: string): string {
  return p.startsWith("~/") ? join(Deno.env.get("HOME")!, p.slice(2)) : p;
}
```

- [ ] **Run tests**

```bash
deno test --allow-all src/config_test.ts
```

Expected: PASS

- [ ] **Commit**

```bash
git add src/config.ts src/config_test.ts
git commit -m "feat: add config loader"
```

---

### Task 5: GitHub Issues provider

**Files:**
- Create: `src/providers/github.ts`
- Create: `src/providers/github_test.ts`

- [ ] **Write failing test**

Create `src/providers/github_test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert";
import { GitHubProvider } from "./github.ts";

Deno.test("fetchNew filters out known IDs", async () => {
  const provider = new GitHubProvider({
    repos: ["jackjennings/lazyboy"],
    token: "fake",
    login: "jackjennings",
    _fetch: async (_url: string) => ([
      { number: 1, title: "One", body: "desc", html_url: "https://github.com/x/y/issues/1" },
      { number: 2, title: "Two", body: "desc2", html_url: "https://github.com/x/y/issues/2" },
    ]),
  });
  const items = await provider.fetchNew(new Set(["gh-1"]));
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "gh-2");
});
```

- [ ] **Run to confirm fail**

```bash
deno test --allow-all src/providers/github_test.ts
```

- [ ] **Implement src/providers/github.ts**

```typescript
import type { Provider, WorkItem } from "./types.ts";

type FetchFn = (url: string) => Promise<unknown[]>;

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  html_url: string;
}

export class GitHubProvider implements Provider {
  private repos: string[];
  private token: string;
  private login: string;
  private _fetch: FetchFn;

  constructor(opts: { repos: string[]; token: string; login: string; _fetch?: FetchFn }) {
    this.repos = opts.repos;
    this.token = opts.token;
    this.login = opts.login;
    this._fetch = opts._fetch ?? this.defaultFetch.bind(this);
  }

  private async defaultFetch(url: string): Promise<unknown[]> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${url}`);
    return res.json();
  }

  async fetchNew(knownIds: Set<string>): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    for (const repo of this.repos) {
      const url = `https://api.github.com/repos/${repo}/issues?assignee=${this.login}&state=open&per_page=50`;
      const issues = await this._fetch(url) as GitHubIssue[];
      for (const issue of issues) {
        const id = `gh-${issue.number}`;
        if (!knownIds.has(id)) {
          items.push({
            id,
            provider: "github",
            title: issue.title,
            description: issue.body ?? "",
            url: issue.html_url,
          });
        }
      }
    }
    return items;
  }
}
```

- [ ] **Run tests**

```bash
deno test --allow-all src/providers/github_test.ts
```

Expected: PASS

- [ ] **Commit**

```bash
git add src/providers/
git commit -m "feat: add GitHub Issues provider"
```

---

### Task 6: Executor and run-phase subprocess

Gondolin's `vm.exec()` is awaitable but not spawn-and-forget. To track running phases across tick invocations, `spawnPhase` launches a separate Deno subprocess (`run-phase.ts`) that owns the VM lifecycle. Its OS PID is what gets stored in `meta.md`.

**Files:**
- Create: `src/executor.ts`
- Create: `src/run-phase.ts`
- Create: `src/executor_test.ts`

- [ ] **Write failing tests**

Create `src/executor_test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert";
import { isPidAlive } from "./executor.ts";

Deno.test("isPidAlive returns true for current process", () => {
  assertEquals(isPidAlive(Deno.pid), true);
});

Deno.test("isPidAlive returns false for dead PID", () => {
  assertEquals(isPidAlive(99999999), false);
});
```

- [ ] **Run to confirm fail**

```bash
deno test --allow-all src/executor_test.ts
```

Expected: FAIL — `executor.ts` not found

- [ ] **Implement src/executor.ts**

```typescript
export interface ExecutorOptions {
  ticketDir: string;
  prompt: string;
  scopeDirs: string[];
  outputFile: string;
  githubToken: string;
  anthropicApiKey: string;
}

export function isPidAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

export function spawnPhase(opts: ExecutorOptions): number {
  const runPhaseScript = new URL("./run-phase.ts", import.meta.url).pathname;
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run", "--allow-all", runPhaseScript,
      "--ticket-dir", opts.ticketDir,
      "--output-file", opts.outputFile,
      "--scope", opts.scopeDirs.join(","),
      "--prompt", opts.prompt,
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

- [ ] **Implement src/run-phase.ts**

```typescript
import { VM, createHttpHooks } from "gondolin";
import { parseArgs } from "jsr:@std/cli/parse-args";
import { join } from "@std/path";

const args = parseArgs(Deno.args, {
  string: ["ticket-dir", "output-file", "scope", "prompt"],
});

const ticketDir = args["ticket-dir"]!;
const outputFile = args["output-file"]!;
const scopeDirs = args["scope"] ? args["scope"].split(",").filter(Boolean) : [];
const prompt = args["prompt"]!;

const githubToken = Deno.env.get("GITHUB_TOKEN") ?? "";
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const mounts: Record<string, string> = { [ticketDir]: "/ticket" };
for (const dir of scopeDirs) {
  mounts[dir] = `/scope/${dir.split("/").pop()}`;
}

const { httpHooks, env } = createHttpHooks({
  allowedHosts: ["api.anthropic.com", "api.github.com"],
  secrets: {
    GITHUB_TOKEN: { hosts: ["api.github.com"], value: githubToken },
    ANTHROPIC_API_KEY: { hosts: ["api.anthropic.com"], value: anthropicApiKey },
  },
});

const vm = await VM.create({ httpHooks, env, mounts });

const contextFiles = ["@/ticket/meta.md"];
if (scopeDirs.length > 0) contextFiles.push("@/scope");

const result = await vm.exec(
  `pi -p "${prompt}" ${contextFiles.join(" ")}`
);

await Deno.writeTextFile(join(ticketDir, outputFile), result.stdout);
await vm.close();
Deno.exit(result.exitCode);
```

- [ ] **Run tests**

```bash
deno test --allow-all src/executor_test.ts
```

Expected: PASS

- [ ] **Commit**

```bash
git add src/executor.ts src/run-phase.ts src/executor_test.ts
git commit -m "feat: add executor and run-phase subprocess"
```

---

### Task 7: Phase prompt templates

**Files:**
- Create: `src/phases/prompts/intake.md`
- Create: `src/phases/prompts/enrichment.md`
- Create: `src/phases/prompts/spec.md`
- Create: `src/phases/prompts/plan.md`
- Create: `src/phases/prompts/implementation.md`
- Create: `src/phases/runners.ts`

- [ ] **Create intake prompt**

Create `src/phases/prompts/intake.md`:

```markdown
You are the intake agent for an automated development pipeline.

Read the ticket in /ticket/meta.md. Based only on the ticket title and description,
propose which directories or repositories from the smarterdx codebase this ticket
will need access to during development.

Output a markdown file with two sections:

## Proposed Scope

A YAML list of absolute paths the subsequent phases will need, for example:
```yaml
scope:
  - ~/code/smarterdx/notes-api
  - ~/code/smarterdx/notes-frontend
```

## Reasoning

One short paragraph explaining why you chose these directories.
```

- [ ] **Create enrichment prompt**

Create `src/phases/prompts/enrichment.md`:

```markdown
You are the enrichment agent for an automated development pipeline.

Read the ticket in /ticket/meta.md and explore the mounted scope directories to
gather context relevant to implementing this ticket.

Output a markdown file covering:

## Relevant Code

Key files, functions, patterns, and interfaces that are relevant to this ticket.
Include file paths and brief descriptions. Quote specific code where useful.

## Dependencies and Constraints

Libraries, services, or architectural constraints that affect the implementation.

## Open Questions

Anything ambiguous in the ticket that will need to be resolved during spec or planning.
```

- [ ] **Create spec prompt**

Create `src/phases/prompts/spec.md`:

```markdown
You are the spec agent for an automated development pipeline.

Read /ticket/meta.md (ticket) and /ticket/enrichment.md (enrichment context).
Write a precise specification for implementing this ticket.

Output a markdown file covering:

## What to Build

Exact behavior, acceptance criteria, and edge cases. Be specific enough that
a developer could implement this without asking questions.

## What NOT to Build

Explicitly call out anything adjacent to the ticket that is out of scope.

## Interface Changes

Any API, data model, or interface changes required.
```

- [ ] **Create plan prompt**

Create `src/phases/prompts/plan.md`:

```markdown
You are the planning agent for an automated development pipeline.

Read /ticket/meta.md (ticket), /ticket/enrichment.md (context), and /ticket/spec.md (spec).
Write a step-by-step implementation plan following TDD principles.

Output a markdown file where each task:
- Names the files to create or modify with exact paths
- Shows the failing test first (with code)
- Shows the minimal implementation to make the test pass (with code)
- Ends with a git commit step
```

- [ ] **Create implementation prompt**

Create `src/phases/prompts/implementation.md`:

```markdown
You are the implementation agent for an automated development pipeline.

Read /ticket/meta.md, /ticket/spec.md, and /ticket/plan.md. Implement the plan
exactly as specified using TDD. Work in the mounted repository worktree.

When done, output a summary of what was changed:

## Changes Made

List each file created or modified with a one-line description.

## Tests

Confirm all tests pass and show the test run output.

## Diff Summary

A brief description of the overall change suitable for a PR description.
```

- [ ] **Create src/phases/runners.ts**

```typescript
import { join } from "@std/path";
import type { ActivePhase } from "./types.ts";
import { PHASE_OUTPUT_FILE } from "./types.ts";

const PROMPT_DIR = new URL("./prompts/", import.meta.url).pathname;

export async function loadPrompt(phase: ActivePhase): Promise<string> {
  return Deno.readTextFile(join(PROMPT_DIR, `${phase}.md`));
}

export function nextPhase(current: ActivePhase): ActivePhase | "done" {
  const seq = ["intake", "enrichment", "spec", "planning", "implementation"] as const;
  const idx = seq.indexOf(current);
  return idx === seq.length - 1 ? "done" : seq[idx + 1];
}

export function outputFileForPhase(phase: ActivePhase): string {
  return PHASE_OUTPUT_FILE[phase];
}
```

- [ ] **Commit**

```bash
git add src/phases/
git commit -m "feat: add phase prompt templates and runners"
```

---

### Task 8: Tick loop

**Files:**
- Create: `src/tick.ts`
- Create: `src/tick_test.ts`

- [ ] **Write failing tests**

Create `src/tick_test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert";
import { advancePhase } from "./tick.ts";
import type { TicketState } from "./state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1", provider: "github", title: "T", url: "u",
    phase: "new", approved: false, scope: [],
    created: "2026-06-15T00:00:00Z", updated: "2026-06-15T00:00:00Z", body: "",
    ...overrides,
  };
}

Deno.test("advancePhase: new ticket starts intake", async () => {
  const spawned: string[] = [];
  const ticket = makeTicket({ phase: "new" });
  await advancePhase(ticket, "/state", {
    spawn: async (_opts) => { spawned.push("intake"); return 123; },
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
  });
  assertEquals(spawned, ["intake"]);
});

Deno.test("advancePhase: running phase with dead PID sets waiting", async () => {
  const written: string[] = [];
  const ticket = makeTicket({ phase: "running-intake", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: async () => 0,
    isPidAlive: () => false,
    writeTicket: async (_, t) => { written.push(t.phase); },
    writePhaseOutput: async () => {},
  });
  assertEquals(written, ["waiting-intake"]);
});

Deno.test("advancePhase: waiting + approved advances to next phase", async () => {
  const spawned: string[] = [];
  const ticket = makeTicket({ phase: "waiting-intake", approved: true });
  await advancePhase(ticket, "/state", {
    spawn: async (opts) => { spawned.push(opts.phase); return 1; },
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
  });
  assertEquals(spawned, ["enrichment"]);
});
```

- [ ] **Run to confirm fail**

```bash
deno test --allow-all src/tick_test.ts
```

- [ ] **Implement src/tick.ts**

```typescript
import { join } from "@std/path";
import { readTicket, writeTicket, writePhaseOutput, listTickets, commitState } from "./state/store.ts";
import { loadConfig, expandHome } from "./config.ts";
import { GitHubProvider } from "./providers/github.ts";
import { spawnPhase, isPidAlive as defaultIsPidAlive } from "./executor.ts";
import { loadPrompt, nextPhase, outputFileForPhase } from "./phases/runners.ts";
import type { TicketState, Phase } from "./state/types.ts";
import type { ActivePhase } from "./phases/types.ts";

export interface TickDeps {
  spawn: (opts: { phase: ActivePhase; ticketDir: string; prompt: string; scope: string[] }) => Promise<number>;
  isPidAlive: (pid: number) => boolean;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  writePhaseOutput: (stateDir: string, id: string, file: string, content: string) => Promise<void>;
}

function runningPhaseToActive(phase: Phase): ActivePhase | null {
  const m = phase.match(/^running-(.+)$/);
  return m ? m[1] as ActivePhase : null;
}

function waitingPhaseToActive(phase: Phase): ActivePhase | null {
  const m = phase.match(/^waiting-(.+)$/);
  return m ? m[1] as ActivePhase : null;
}

export async function advancePhase(ticket: TicketState, stateDir: string, deps: TickDeps): Promise<void> {
  const now = new Date().toISOString();

  if (ticket.phase === "new") {
    const prompt = await loadPrompt("intake");
    const pid = await deps.spawn({ phase: "intake", ticketDir: join(stateDir, ticket.id), prompt, scope: [] });
    await deps.writeTicket(stateDir, { ...ticket, phase: "running-intake", pid, updated: now });
    return;
  }

  const runningPhase = runningPhaseToActive(ticket.phase);
  if (runningPhase) {
    if (ticket.pid && !deps.isPidAlive(ticket.pid)) {
      await deps.writeTicket(stateDir, { ...ticket, phase: `waiting-${runningPhase}` as Phase, pid: undefined, updated: now });
    }
    return;
  }

  const waitingPhase = waitingPhaseToActive(ticket.phase);
  if (waitingPhase && ticket.approved) {
    const next = nextPhase(waitingPhase as ActivePhase);
    if (next === "done") {
      await deps.writeTicket(stateDir, { ...ticket, phase: "waiting-merge", approved: false, updated: now });
      return;
    }
    const prompt = await loadPrompt(next as ActivePhase);
    const pid = await deps.spawn({ phase: next as ActivePhase, ticketDir: join(stateDir, ticket.id), prompt, scope: ticket.scope });
    await deps.writeTicket(stateDir, { ...ticket, phase: `running-${next}` as Phase, approved: false, pid, updated: now });
  }
}

export async function tick(): Promise<void> {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const pidFile = join(Deno.env.get("HOME")!, ".config", "lazyboy", "tick.pid");

  // Acquire lock
  try {
    const existing = await Deno.readTextFile(pidFile).catch(() => null);
    if (existing) {
      const pid = parseInt(existing.trim(), 10);
      if (defaultIsPidAlive(pid)) {
        console.log(`tick already running (pid ${pid}), exiting`);
        return;
      }
    }
    await Deno.mkdir(join(Deno.env.get("HOME")!, ".config", "lazyboy"), { recursive: true });
    await Deno.writeTextFile(pidFile, String(Deno.pid));
  } catch (e) {
    console.error("Failed to acquire lock:", e);
    return;
  }

  try {
    // Fetch new work
    const token = Deno.env.get("GITHUB_TOKEN") ?? "";
    const login = Deno.env.get("GITHUB_LOGIN") ?? "";
    const provider = new GitHubProvider({ repos: config.github.repos, token, login });
    const existingIds = new Set(await listTickets(stateDir));
    const newItems = await provider.fetchNew(existingIds);

    for (const item of newItems) {
      await writeTicket(stateDir, {
        id: item.id, provider: item.provider, title: item.title, url: item.url,
        phase: "new", approved: false, scope: [],
        created: new Date().toISOString(), updated: new Date().toISOString(),
        body: item.description,
      });
    }

    // Advance tickets
    const activePhases = config.tick.concurrency;
    let running = 0;
    const ids = await listTickets(stateDir);

    for (const id of ids) {
      const ticket = await readTicket(stateDir, id);
      if (ticket.phase.startsWith("running-")) running++;
    }

    for (const id of ids) {
      const ticket = await readTicket(stateDir, id);
      if (ticket.phase === "needs-attention" || ticket.phase === "done" || ticket.phase === "waiting-merge") continue;
      if (ticket.phase === "new" || (ticket.phase.startsWith("waiting-") && ticket.approved)) {
        if (running >= activePhases) continue;
        running++;
      }
      await advancePhase(ticket, stateDir, {
        spawn: async (opts) => spawnPhase({
          ticketDir: opts.ticketDir,
          prompt: opts.prompt,
          scopeDirs: opts.scope.map(expandHome),
          outputFile: outputFileForPhase(opts.phase),
          githubToken: token,
          anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        }),
        isPidAlive: defaultIsPidAlive,
        writeTicket,
        writePhaseOutput,
      });
    }

    await commitState(stateDir, `tick: ${new Date().toISOString()}`);
  } finally {
    await Deno.remove(pidFile).catch(() => {});
  }
}
```

- [ ] **Run tests**

```bash
deno test --allow-all src/tick_test.ts
```

Expected: PASS

- [ ] **Commit**

```bash
git add src/tick.ts src/tick_test.ts
git commit -m "feat: add tick loop"
```

---

### Task 9: CLI entrypoint

**Files:**
- Create: `src/index.ts`

- [ ] **Implement src/index.ts**

```typescript
import { tick } from "./tick.ts";
import { readTicket, writeTicket, listTickets } from "./state/store.ts";
import { loadConfig, expandHome } from "./config.ts";

const command = Deno.args[0];

if (command === "tick") {
  await tick();

} else if (command === "approve") {
  const id = Deno.args[1];
  if (!id) { console.error("Usage: lazyboy approve <ticket-id>"); Deno.exit(1); }
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const ticket = await readTicket(stateDir, id);
  await writeTicket(stateDir, { ...ticket, approved: true, updated: new Date().toISOString() });
  const { commitState } = await import("./state/store.ts");
  await commitState(stateDir, `approve: ${id}`);
  console.log(`Approved ${id} (phase: ${ticket.phase})`);

} else if (command === "status") {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const ids = await listTickets(stateDir);
  if (ids.length === 0) { console.log("No active tickets."); Deno.exit(0); }
  console.log(`${"ID".padEnd(20)} ${"PHASE".padEnd(25)} ${"WAITING".padEnd(8)} TITLE`);
  console.log("-".repeat(80));
  for (const id of ids.sort()) {
    const t = await readTicket(stateDir, id);
    const waiting = t.phase.startsWith("waiting-") && !t.approved ? "YES" : "";
    console.log(`${t.id.padEnd(20)} ${t.phase.padEnd(25)} ${waiting.padEnd(8)} ${t.title}`);
  }

} else {
  console.error("Usage: lazyboy <tick|approve|status>");
  Deno.exit(1);
}
```

- [ ] **Smoke test the CLI**

```bash
cd ~/code/jackjennings/lazyboy
deno run --allow-all src/index.ts status
```

Expected: "No active tickets." (or a table if state dir has tickets)

- [ ] **Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entrypoint"
```

---

### Task 10: Cron setup and state repo initialization

**Files:**
- (No code files — setup only)

- [ ] **Initialize state repo if needed**

```bash
mkdir -p ~/code/jackjennings/projects
cd ~/code/jackjennings/projects
git init
git commit --allow-empty -m "chore: initialize lazyboy state repo"
```

- [ ] **Create default config**

```bash
mkdir -p ~/.config/lazyboy
cat > ~/.config/lazyboy/config.toml << 'EOF'
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2
EOF
```

- [ ] **Test a manual tick**

```bash
cd ~/code/jackjennings/lazyboy
GITHUB_TOKEN=$(gh auth token) \
GITHUB_LOGIN=$(gh api user --jq .login) \
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
deno run --allow-all src/index.ts tick
```

Expected: runs without error; `lazyboy status` shows any newly assigned issues.

- [ ] **Add cron entry**

```bash
LAZYBOY_DIR=~/code/jackjennings/lazyboy
(crontab -l 2>/dev/null; echo "*/15 * * * * cd $LAZYBOY_DIR && GITHUB_TOKEN=\$(gh auth token) GITHUB_LOGIN=jackjennings ANTHROPIC_API_KEY=\$ANTHROPIC_API_KEY deno run --allow-all src/index.ts tick >> ~/.config/lazyboy/tick.log 2>&1") | crontab -
```

- [ ] **Verify cron entry**

```bash
crontab -l | grep lazyboy
```

Expected: shows the lazyboy tick entry

- [ ] **Final commit**

```bash
cd ~/code/jackjennings/lazyboy
git add -A
git commit -m "chore: complete sub-project 1 core loop"
```

---

### Task 11: Enforce TDD and evidence requirements in phase prompts

**Files:**
- Modify: `src/phases/prompts/implementation.md`
- Modify: `src/phases/prompts/enrichment.md`
- Modify: `src/phases/prompts/spec.md`
- Modify: `src/phases/prompts/plan.md`
- Modify: `src/phases/prompts/intake.md`

- [ ] **Rewrite `src/phases/prompts/implementation.md`**

Replace the file entirely with:

```markdown
You are the implementation agent for an automated development pipeline.

Read /ticket/meta.md, /ticket/spec.md, and /ticket/plan.md. Implement the plan
exactly as specified. Work in the mounted repository worktree.

## TDD is mandatory. Follow this cycle for every function:

1. Write a failing test that describes the behavior.
2. Run the test suite and confirm the new test FAILS. If it passes immediately,
   the test is wrong — fix it before writing any production code.
3. Write the minimal code to make the test pass. No extra logic, no refactoring.
4. Run the test suite and confirm the test PASSES and no existing tests broke.
5. Refactor only after green. Do not add behavior during refactor.

There are no exceptions to step 2. If you did not watch the test fail,
you do not know whether the test is valid.

## Failure limit

If you have attempted to fix the same failing test three or more times without
success, stop. Write a diagnostic under "Needs Attention" below and exit with
a non-zero status code. Do not attempt a fourth fix.

## Output

When done, write the following to your output:

## Changes Made

List each file created or modified with a one-line description.

## Tests

Paste the full test runner output. Do not summarise it.

## Diff Summary

One paragraph describing the overall change, suitable for a PR description.

## Needs Attention

If the failure limit was reached: describe the failing test, the three fix
attempts made, and your hypothesis about the root cause.
Otherwise: leave this section empty.
```

- [ ] **Update `src/phases/prompts/enrichment.md`**

Append to the end of the file:

```markdown

## Evidence requirement

Your output must be specific enough to verify. For each item under
"Relevant Code", include the exact file path and the specific function,
type, or line range you are referencing. Vague descriptions ("there is
an auth module") are not sufficient.
```

- [ ] **Update `src/phases/prompts/spec.md`**

Replace the "## What to Build" section guidance with:

```markdown
## What to Build

List acceptance criteria as checkboxes. Each criterion must be independently
verifiable — a reviewer should be able to check it off by reading the diff or
running a test, not by making a judgement call.

- [ ] Criterion one
- [ ] Criterion two
```

- [ ] **Update `src/phases/prompts/plan.md`**

Append to the end of the file:

```markdown

## Evidence requirement

Every task in your plan must include the exact command used to verify it
passes and the expected output. "Run the tests" is not sufficient —
write `deno test src/foo_test.ts` and state what the passing output looks like.
```

- [ ] **Update `src/phases/prompts/intake.md`**

Append to the end of the file:

```markdown

## Evidence requirement

The scope you propose must list absolute paths. Vague references
("the frontend code") are not sufficient.
```

- [ ] **Commit**

```bash
cd ~/code/jackjennings/lazyboy
git add src/phases/prompts/
git commit -m "feat: enforce TDD iron law and evidence requirements in phase prompts"
```

---

### Task 12: Cap implementation retries and surface needs-attention

The implementation prompt (Task 11) already instructs the agent to exit non-zero after 3+ failed fix attempts. This task confirms the tick loop handles that correctly and adds a test.

**Files:**
- Verify: `src/tick.ts` (existing `running-*` → `needs-attention` on non-zero exit)
- Modify: `src/tick_test.ts`

- [ ] **Verify existing behaviour**

Read `src/tick.ts` and confirm the `running-*` branch sets `needs-attention` when the PID exits. The current logic sets `waiting-*` on any dead PID — it does not distinguish exit codes because the PID check only tells us whether the process is alive or dead, not its exit code.

The exit code is written to a file by `run-phase.ts` (`Deno.exit(result.exitCode)`). To distinguish success from failure the tick needs to read an exit-code file written by the subprocess.

- [ ] **Update `src/run-phase.ts` to write exit status**

Add before `Deno.exit(result.exitCode)`:

```typescript
const statusFile = join(ticketDir, ".phase-status");
await Deno.writeTextFile(statusFile, String(result.exitCode));
```

- [ ] **Update `src/tick.ts` to read exit status**

In the `runningPhase !== null` branch, after detecting a dead PID, read `.phase-status` to determine whether to set `waiting-*` or `needs-attention`:

```typescript
if (ticket.pid !== undefined && !deps.isPidAlive(ticket.pid)) {
  const statusFile = join(stateDir, ticket.id, ".phase-status");
  let exitCode = 0;
  try {
    exitCode = parseInt(await Deno.readTextFile(statusFile), 10);
  } catch { /* file absent = assume success */ }
  const nextPhase = exitCode === 0
    ? `waiting-${runningPhase}` as Phase
    : "needs-attention" as Phase;
  await deps.writeTicket(stateDir, { ...ticket, phase: nextPhase, pid: undefined, updated: now });
}
```

Update `TickDeps` to include a `readFile` dep so this is testable:

```typescript
export interface TickDeps {
  spawn: (opts: { phase: ActivePhase; ticketDir: string; prompt: string; scope: string[] }) => Promise<number>;
  isPidAlive: (pid: number) => boolean;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  writePhaseOutput: (stateDir: string, id: string, file: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string | null>;
}
```

Update all existing `advancePhase` calls in `tick.ts` to pass `readFile: async (p) => { try { return await Deno.readTextFile(p); } catch { return null; } }`.

- [ ] **Add tests to `src/tick_test.ts`**

```typescript
Deno.test("advancePhase: running phase with dead PID and non-zero exit sets needs-attention", async () => {
  const written: string[] = [];
  const ticket = makeTicket({ phase: "running-intake", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: async () => 0,
    isPidAlive: () => false,
    writeTicket: async (_dir, t) => { written.push(t.phase); },
    writePhaseOutput: async () => {},
    readFile: async () => "1",
  });
  assertEquals(written, ["needs-attention"]);
});

Deno.test("advancePhase: running phase with dead PID and zero exit sets waiting", async () => {
  const written: string[] = [];
  const ticket = makeTicket({ phase: "running-intake", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: async () => 0,
    isPidAlive: () => false,
    writeTicket: async (_dir, t) => { written.push(t.phase); },
    writePhaseOutput: async () => {},
    readFile: async () => "0",
  });
  assertEquals(written, ["waiting-intake"]);
});
```

- [ ] **Update existing tests** to pass `readFile: async () => "0"` in all existing `advancePhase` test deps objects.

- [ ] **Run tests**

```bash
cd ~/code/jackjennings/lazyboy
deno test --allow-all src/tick_test.ts
```

Expected: all tests PASS

- [ ] **Commit**

```bash
cd ~/code/jackjennings/lazyboy
git add src/run-phase.ts src/tick.ts src/tick_test.ts
git commit -m "feat: surface non-zero phase exit as needs-attention"
```
