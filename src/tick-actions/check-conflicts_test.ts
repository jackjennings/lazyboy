import { assertEquals } from "@std/assert";
import { checkConflictsAction } from "./check-conflicts.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-7",
    provider: "github",
    title: "T",
    url: "https://github.com/myorg/myrepo/issues/7",
    phase: "implementation",
    status: "running",
    approved: false,
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
  overrides: Partial<Parameters<typeof checkConflictsAction>[0]> = {},
) {
  return checkConflictsAction({
    runGit: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    isPidAlive: () => false,
    worktreeExists: () => true,
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    ...overrides,
  });
}

// ── applies ──────────────────────────────────────────────────────────────────

Deno.test("checkConflictsAction: applies to ticket with worktrees and no live pid", () => {
  assertEquals(makeAction().applies(makeTicket()), true);
});

Deno.test("checkConflictsAction: applies to non-implementation phase with worktrees", () => {
  assertEquals(
    makeAction().applies(makeTicket({ phase: "plan", status: "running" })),
    true,
  );
});

Deno.test("checkConflictsAction: does not apply to needs-attention", () => {
  assertEquals(
    makeAction().applies(makeTicket({ status: "needs-attention" })),
    false,
  );
});

Deno.test("checkConflictsAction: does not apply when pid is alive", () => {
  assertEquals(
    makeAction({
      isPidAlive: () => true,
    }).applies(makeTicket({ pid: 999 })),
    false,
  );
});

Deno.test("checkConflictsAction: applies when pid is undefined (treat as dead)", () => {
  assertEquals(
    makeAction({
      isPidAlive: () => true,
    }).applies(makeTicket({ pid: undefined })),
    true,
  );
});

Deno.test("checkConflictsAction: does not apply with no worktrees", () => {
  assertEquals(
    makeAction().applies(makeTicket({ worktrees: {} })),
    false,
  );
});

Deno.test("checkConflictsAction: does not apply when worktree path does not exist on disk", () => {
  assertEquals(
    makeAction({ worktreeExists: () => false }).applies(makeTicket()),
    false,
  );
});

// ── fetch failure ─────────────────────────────────────────────────────────────

Deno.test("checkConflictsAction: fetch failure logs error and returns null", async () => {
  const logged: object[] = [];
  const calls: string[][] = [];
  const result = await makeAction({
    runGit: (args) => {
      calls.push(args);
      if (args[0] === "fetch") {
        return Promise.resolve({
          code: 1,
          stdout: "",
          stderr: "network error",
        });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  }).run(makeTicket(), "/state");
  assertEquals(result, null);
  assertEquals(logged.length, 1);
  assertEquals((logged[0] as Record<string, unknown>).event, "error");
  assertEquals(
    (logged[0] as Record<string, unknown>).context,
    "checkConflicts",
  );
  assertEquals(
    (logged[0] as Record<string, unknown>).worktreePath,
    "/wt/myorg/myrepo",
  );
  assertEquals((logged[0] as Record<string, unknown>).stderr, "network error");
});

// ── clean rebase ──────────────────────────────────────────────────────────────

Deno.test("checkConflictsAction: clean rebase and push → null, logs success", async () => {
  const logged: object[] = [];
  const calls: string[][] = [];
  const result = await makeAction({
    runGit: (args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: "up to date", stderr: "" });
    },
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  }).run(
    makeTicket({ prUrl: "https://github.com/myorg/myrepo/pull/7" }),
    "/state",
  );
  assertEquals(result, null);
  const rebaseClean = (logged as Record<string, unknown>[]).find(
    (e) => e.event === "success",
  );
  assertEquals(rebaseClean !== undefined, true);
  assertEquals(rebaseClean!.context, "checkConflicts");
  assertEquals(rebaseClean!.worktreePath, "/wt/myorg/myrepo");
  assertEquals(rebaseClean!.branch, "gh-7");
  assertEquals(calls.some((a) => a[0] === "push"), true);
});

Deno.test("checkConflictsAction: clean rebase with no prUrl → null, no push, no log", async () => {
  const logged: object[] = [];
  const calls: string[][] = [];
  const result = await makeAction({
    runGit: (args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: "up to date", stderr: "" });
    },
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  }).run(makeTicket(), "/state");
  assertEquals(result, null);
  assertEquals(calls.some((a) => a[0] === "push"), false);
  assertEquals(logged.length, 0);
});

// ── push failure after clean rebase ──────────────────────────────────────────

Deno.test("checkConflictsAction: push failure logs error but returns null (transient)", async () => {
  const logged: object[] = [];
  const result = await makeAction({
    runGit: (args) => {
      if (args[0] === "push") {
        return Promise.resolve({ code: 1, stdout: "", stderr: "auth failure" });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  }).run(
    makeTicket({ prUrl: "https://github.com/myorg/myrepo/pull/7" }),
    "/state",
  );
  assertEquals(result, null);
  const errorEntries = (logged as Record<string, unknown>[]).filter(
    (e) => e.event === "error",
  );
  assertEquals(errorEntries.length, 1);
  assertEquals(errorEntries[0].context, "checkConflicts");
  assertEquals(errorEntries[0].pushStderr, "auth failure");
});

// ── conflict detected ─────────────────────────────────────────────────────────

Deno.test(
  "checkConflictsAction: rebase conflict → needs-attention, aborts, logs conflict-detected",
  async () => {
    const logged: object[] = [];
    const written: TicketState[] = [];
    const calls: string[][] = [];
    const result = await makeAction({
      runGit: (args) => {
        calls.push(args);
        if (args[0] === "rebase" && args[1] !== "--abort") {
          return Promise.resolve({
            code: 1,
            stdout: "",
            stderr:
              "CONFLICT (content): Merge conflict in foo.ts\nCould not apply abc123...",
          });
        }
        if (args[0] === "diff") {
          return Promise.resolve(
            { code: 0, stdout: "foo.ts\nbar.ts", stderr: "" },
          );
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
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

    assertEquals(result?.status, "needs-attention");
    assertEquals(written.length, 1);
    assertEquals(written[0].status, "needs-attention");
    assertEquals(
      calls.some((a) => a[0] === "rebase" && a[1] === "--abort"),
      true,
    );

    const conflictEntry = (logged as Record<string, unknown>[]).find(
      (e) => e.event === "conflict-detected",
    );
    assertEquals(conflictEntry !== undefined, true);
    assertEquals(conflictEntry!.context, "checkConflicts");
    assertEquals(conflictEntry!.worktreePath, "/wt/myorg/myrepo");
    assertEquals(conflictEntry!.branch, "gh-7");
    assertEquals(conflictEntry!.conflictedFiles, ["foo.ts", "bar.ts"]);
    assertEquals(
      (conflictEntry!.rebaseStderr as string).includes("CONFLICT"),
      true,
    );
  },
);

// ── multiple worktrees — all evaluated ───────────────────────────────────────

Deno.test(
  "checkConflictsAction: multiple worktrees — fetch error in first does not skip second",
  async () => {
    const logged: object[] = [];
    const result = await makeAction({
      runGit: (args, cwd) => {
        if (args[0] === "fetch" && cwd === "/wt/a/repo") {
          return Promise.resolve(
            { code: 1, stdout: "", stderr: "network" },
          );
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      appendLog: (_dir, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
    }).run(
      makeTicket({
        prUrl: "https://github.com/myorg/myrepo/pull/7",
        worktrees: {
          "a/repo": { path: "/wt/a/repo", branch: "gh-7" },
          "b/repo": { path: "/wt/b/repo", branch: "gh-7" },
        },
      }),
      "/state",
    );
    assertEquals(result, null);
    const rebaseClean = (logged as Record<string, unknown>[]).find(
      (e) => e.event === "success",
    );
    assertEquals(rebaseClean !== undefined, true);
  },
);

Deno.test(
  "checkConflictsAction: multiple worktrees — all conflicts collected before returning needs-attention",
  async () => {
    const conflictPaths: string[] = [];
    const result = await makeAction({
      runGit: (args, cwd) => {
        if (args[0] === "rebase" && args[1] !== "--abort") {
          return Promise.resolve(
            { code: 1, stdout: "", stderr: "CONFLICT" },
          );
        }
        if (args[0] === "diff") {
          return Promise.resolve({
            code: 0,
            stdout: cwd === "/wt/a/repo" ? "a.ts" : "b.ts",
            stderr: "",
          });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      appendLog: (_dir, _id, entry) => {
        const e = entry as Record<string, unknown>;
        if (e.event === "conflict-detected") {
          conflictPaths.push(e.worktreePath as string);
        }
        return Promise.resolve();
      },
      writeTicket: () => Promise.resolve(),
    }).run(
      makeTicket({
        worktrees: {
          "a/repo": { path: "/wt/a/repo", branch: "gh-7" },
          "b/repo": { path: "/wt/b/repo", branch: "gh-7" },
        },
      }),
      "/state",
    );
    assertEquals(result?.status, "needs-attention");
    assertEquals(conflictPaths.length, 2);
    assertEquals(conflictPaths.includes("/wt/a/repo"), true);
    assertEquals(conflictPaths.includes("/wt/b/repo"), true);
  },
);
