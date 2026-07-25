import { assertEquals } from "@std/assert";
import { resolveConflictsAction } from "./resolve-conflicts.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-7",
    provider: "github",
    title: "T",
    url: "https://github.com/myorg/myrepo/issues/7",
    phase: "implementation",
    status: "running",
    approvals: [],
    scope: [],
    worktrees: {
      "myorg/myrepo": { path: "/wt/myorg/myrepo", branch: "gh-7" },
    },
    created: "2026-06-30T00:00:00Z",
    updated: "2026-06-30T00:00:00Z",
    body: "",
    ...overrides,
  };
}

function makeAction(
  overrides: Partial<Parameters<typeof resolveConflictsAction>[0]> = {},
) {
  return resolveConflictsAction({
    runGit: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    stat: () => Promise.resolve(null),
    readDir: async function* () {},
    remove: () => Promise.resolve(),
    ...overrides,
  });
}

// ── applies ──────────────────────────────────────────────────────────────────

Deno.test("resolveConflictsAction: applies when running, pid dead", () => {
  assertEquals(makeAction().applies(makeTicket()), true);
});

Deno.test("resolveConflictsAction: does not apply when pid is alive", () => {
  assertEquals(
    makeAction({ isProcessAlive: () => true }).applies(makeTicket()),
    false,
  );
});

Deno.test("resolveConflictsAction: does not apply when status is not running", () => {
  assertEquals(
    makeAction().applies(makeTicket({ status: "waiting" })),
    false,
  );
});

// ── run returns null with no context files ────────────────────────────────────

Deno.test(
  "resolveConflictsAction: run returns null when no conflict-context files found",
  async () => {
    const result = await makeAction({
      readDir: async function* () {
        yield { name: "plan.md", isFile: true };
      },
    }).run(makeTicket(), "/state");
    assertEquals(result, null);
  },
);

// ── success path ──────────────────────────────────────────────────────────────

Deno.test(
  "resolveConflictsAction: success — no REBASE_HEAD, pushes, logs conflict-resolved, status waiting",
  async () => {
    const logged: object[] = [];
    const written: TicketState[] = [];
    const gitCalls: string[][] = [];
    const removed: string[] = [];

    const result = await makeAction({
      runGit: (args) => {
        gitCalls.push(args);
        if (args[0] === "rev-parse") {
          return Promise.resolve({ code: 0, stdout: "/wt/.git\n", stderr: "" });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      stat: (path) => {
        if (path.endsWith("REBASE_HEAD")) return Promise.resolve(null);
        return Promise.resolve({ isFile: true });
      },
      readDir: async function* () {
        yield { name: "conflict-context-gh-7.md", isFile: true };
      },
      remove: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
      writeTicket: (_dir, t) => {
        written.push(t);
        return Promise.resolve();
      },
      appendLog: (_dir, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
    }).run(makeTicket(), "/state");

    assertEquals(gitCalls.some((a) => a[0] === "push"), true);
    assertEquals(removed.length > 0, true);
    assertEquals(result?.status, "waiting");

    const resolved = (logged as Record<string, unknown>[]).find(
      (e) => e.event === "conflict-resolved",
    );
    assertEquals(resolved !== undefined, true);
    assertEquals(resolved!.worktreePath, "/wt/myorg/myrepo");
    assertEquals(resolved!.branch, "gh-7");
  },
);

// ── multiple worktrees — only the resolved one is touched ────────────────────

Deno.test(
  "resolveConflictsAction: multi-worktree — only pushes/logs the worktree with a matching context file",
  async () => {
    const logged: object[] = [];
    const gitCalls: { args: string[]; cwd: string }[] = [];

    const result = await makeAction({
      runGit: (args, cwd) => {
        gitCalls.push({ args, cwd });
        if (args[0] === "rev-parse") {
          return Promise.resolve({ code: 0, stdout: "/wt/.git\n", stderr: "" });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      stat: () => Promise.resolve(null),
      readDir: async function* () {
        yield { name: "conflict-context-a-repo.md", isFile: true };
      },
      remove: () => Promise.resolve(),
      appendLog: (_dir, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
    }).run(
      makeTicket({
        worktrees: {
          "a/repo": { path: "/wt/a/repo", branch: "a-repo" },
          "b/repo": { path: "/wt/b/repo", branch: "b-repo" },
        },
      }),
      "/state",
    );

    assertEquals(result?.status, "waiting");
    assertEquals(
      gitCalls.some((c) => c.cwd === "/wt/b/repo"),
      false,
    );
    // (no pid assertion — pid field removed from TicketState)
    const resolvedEntries = (logged as Record<string, unknown>[]).filter(
      (e) => e.event === "conflict-resolved",
    );
    assertEquals(resolvedEntries.length, 1);
    assertEquals(resolvedEntries[0].branch, "a-repo");
  },
);

// ── failure path: REBASE_HEAD present ────────────────────────────────────────

Deno.test(
  "resolveConflictsAction: failure — REBASE_HEAD present → aborts, logs agent-failed, status needs-attention",
  async () => {
    const logged: object[] = [];
    const written: TicketState[] = [];
    const gitCalls: string[][] = [];
    const removed: string[] = [];

    const result = await makeAction({
      runGit: (args) => {
        gitCalls.push(args);
        if (args[0] === "rev-parse") {
          return Promise.resolve({ code: 0, stdout: "/wt/.git\n", stderr: "" });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      stat: (path) => {
        if (path.endsWith("REBASE_HEAD")) {
          return Promise.resolve({ isFile: true });
        }
        return Promise.resolve(null);
      },
      readDir: async function* () {
        yield { name: "conflict-context-gh-7.md", isFile: true };
      },
      remove: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
      writeTicket: (_dir, t) => {
        written.push(t);
        return Promise.resolve();
      },
      appendLog: (_dir, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
    }).run(makeTicket(), "/state");

    assertEquals(
      gitCalls.some((a) => a[0] === "rebase" && a[1] === "--abort"),
      true,
    );
    assertEquals(removed.length > 0, true);
    assertEquals(result?.status, "needs-attention");

    const failed = (logged as Record<string, unknown>[]).find(
      (e) => e.event === "conflict-resolution-failed",
    );
    assertEquals(failed !== undefined, true);
    assertEquals(failed!.reason, "agent-failed");
  },
);

// ── failure path: push fails ──────────────────────────────────────────────────

Deno.test(
  "resolveConflictsAction: failure — push fails → logs push-failed, status needs-attention",
  async () => {
    const logged: object[] = [];
    const written: TicketState[] = [];
    const gitCalls: string[][] = [];

    const result = await makeAction({
      runGit: (args) => {
        gitCalls.push(args);
        if (args[0] === "push") {
          return Promise.resolve({
            code: 1,
            stdout: "",
            stderr: "auth failure",
          });
        }
        if (args[0] === "rev-parse") {
          return Promise.resolve({ code: 0, stdout: "/wt/.git\n", stderr: "" });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      stat: (path) => {
        if (path.endsWith("REBASE_HEAD")) return Promise.resolve(null);
        return Promise.resolve({ isFile: true });
      },
      readDir: async function* () {
        yield { name: "conflict-context-gh-7.md", isFile: true };
      },
      remove: () => Promise.resolve(),
      writeTicket: (_dir, t) => {
        written.push(t);
        return Promise.resolve();
      },
      appendLog: (_dir, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
    }).run(makeTicket(), "/state");

    assertEquals(result?.status, "needs-attention");

    const failed = (logged as Record<string, unknown>[]).find(
      (e) => e.event === "conflict-resolution-failed",
    );
    assertEquals(failed !== undefined, true);
    assertEquals(failed!.reason, "push-failed");
  },
);
