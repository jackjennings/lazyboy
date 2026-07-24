import { assertEquals, assertNotEquals } from "@std/assert";
import {
  checkConflictsAction,
  sanitizeBranchForFilename,
} from "./check-conflicts.ts";
import type { TicketState } from "../state/types.ts";

// ── sanitizeBranchForFilename ─────────────────────────────────────────────────

Deno.test("sanitizeBranchForFilename: branches differing only by '/' vs '-' do not collide", () => {
  assertNotEquals(
    sanitizeBranchForFilename("gh-76"),
    sanitizeBranchForFilename("gh/76"),
  );
});

Deno.test("sanitizeBranchForFilename: leaves simple branch names unchanged", () => {
  assertEquals(sanitizeBranchForFilename("gh-7"), "gh-7");
});

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
    isProcessAlive: () => false,
    worktreeExists: () => true,
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    spawn: () => Promise.resolve(),
    writeContextFile: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-opus-4-7", thinking: "high" }),
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

Deno.test("checkConflictsAction: does not apply to merge phase — work is already done", () => {
  assertEquals(
    makeAction().applies(makeTicket({ phase: "merge", status: "waiting" })),
    false,
  );
});

Deno.test("checkConflictsAction: does not apply when pid is alive", () => {
  assertEquals(
    makeAction({
      isProcessAlive: () => true,
    }).applies(makeTicket()),
    false,
  );
});

Deno.test("checkConflictsAction: applies when no live process", () => {
  assertEquals(
    makeAction({ isProcessAlive: () => false }).applies(makeTicket()),
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
    makeTicket({
      prs: [{
        url: "https://github.com/myorg/myrepo/pull/7",
        title: "",
        dependsOn: [],
        merged: false,
      }],
    }),
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

Deno.test("checkConflictsAction: clean rebase with no prs → null, no push, no log", async () => {
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
    makeTicket({
      prs: [{
        url: "https://github.com/myorg/myrepo/pull/7",
        title: "",
        dependsOn: [],
        merged: false,
      }],
    }),
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
  "checkConflictsAction: rebase conflict → spawns agent, status running, logs conflict-resolution-started",
  async () => {
    const logged: object[] = [];
    const written: TicketState[] = [];
    const calls: string[][] = [];
    const spawnCalls: object[] = [];
    const contextFiles: { branch: string; content: string }[] = [];

    const result = await makeAction({
      runGit: (args) => {
        calls.push(args);
        if (args[0] === "rebase" && args[1] === "origin/main") {
          return Promise.resolve({
            code: 1,
            stdout: "",
            stderr: "CONFLICT (content): Merge conflict in foo.ts",
          });
        }
        if (args[0] === "diff") {
          return Promise.resolve({
            code: 0,
            stdout: "foo.ts\nbar.ts",
            stderr: "",
          });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      spawn: (opts) => {
        spawnCalls.push(opts);
        return Promise.resolve();
      },
      writeContextFile: (_ticketDir, branch, content) => {
        contextFiles.push({ branch, content });
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
      calls.some((a) => a[0] === "rebase" && a[1] === "--abort"),
      false,
    );
    assertEquals(spawnCalls.length, 1);
    assertEquals(contextFiles.length, 1);
    assertEquals(contextFiles[0].branch, "gh-7");
    assertEquals(result?.status, "running");

    const startEntry = (logged as Record<string, unknown>[]).find(
      (e) => e.event === "conflict-resolution-started",
    );
    assertEquals(startEntry !== undefined, true);
    assertEquals(startEntry!.worktreePath, "/wt/myorg/myrepo");
    assertEquals(startEntry!.branch, "gh-7");
    assertEquals(startEntry!.conflictedFiles, ["foo.ts", "bar.ts"]);
    assertEquals(
      (startEntry!.rebaseStderr as string).includes("CONFLICT"),
      true,
    );
  },
);

Deno.test(
  "checkConflictsAction: spawn receives model and thinking from resolveModelConfig(ticket)",
  async () => {
    const spawnCalls: Record<string, unknown>[] = [];

    await makeAction({
      runGit: (args) => {
        if (args[0] === "rebase" && args[1] === "origin/main") {
          return Promise.resolve({
            code: 1,
            stdout: "",
            stderr: "CONFLICT",
          });
        }
        if (args[0] === "diff") {
          return Promise.resolve({ code: 0, stdout: "foo.ts", stderr: "" });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      spawn: (opts) => {
        spawnCalls.push(opts);
        return Promise.resolve();
      },
      resolveModelConfig: (ticket) => {
        assertEquals(ticket.id, "gh-7");
        return { model: "claude-sonnet-4-6", thinking: "off" };
      },
    }).run(makeTicket(), "/state");

    assertEquals(spawnCalls.length, 1);
    assertEquals(spawnCalls[0].model, "claude-sonnet-4-6");
    assertEquals(spawnCalls[0].thinking, "off");
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
        prs: [{
          url: "https://github.com/myorg/myrepo/pull/7",
          title: "",
          dependsOn: [],
          merged: false,
        }],
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
  "checkConflictsAction: multiple worktrees — loop stops after first conflict spawns agent",
  async () => {
    const spawnCalls: object[] = [];
    const gitCalls: { args: string[]; cwd: string }[] = [];

    await makeAction({
      runGit: (args, cwd) => {
        gitCalls.push({ args, cwd });
        if (args[0] === "rebase" && args[1] === "origin/main") {
          return Promise.resolve({ code: 1, stdout: "", stderr: "CONFLICT" });
        }
        if (args[0] === "diff") {
          return Promise.resolve({ code: 0, stdout: "a.ts", stderr: "" });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      spawn: (opts) => {
        spawnCalls.push(opts);
        return Promise.resolve();
      },
      writeContextFile: () => Promise.resolve(),
      writeTicket: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
    }).run(
      makeTicket({
        worktrees: {
          "a/repo": { path: "/wt/a/repo", branch: "gh-7" },
          "b/repo": { path: "/wt/b/repo", branch: "gh-7" },
        },
      }),
      "/state",
    );

    assertEquals(spawnCalls.length, 1);
    assertEquals(
      gitCalls.filter((c) => c.cwd === "/wt/b/repo").length,
      0,
    );
  },
);
