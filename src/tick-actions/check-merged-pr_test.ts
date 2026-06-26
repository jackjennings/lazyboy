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
    worktrees: {
      "myorg/myrepo": { path: "/wt/myorg/myrepo", branch: "gh-42" },
    },
    prUrl: "https://github.com/myorg/myrepo/pull/99",
    created: "2026-06-23T00:00:00Z",
    updated: "2026-06-23T00:00:00Z",
    body: "",
    ...overrides,
  };
}

function makeAction(
  overrides: Partial<Parameters<typeof checkMergedPRAction>[0]> = {},
) {
  return checkMergedPRAction({
    isPRMerged: async () => false,
    cleanupWorktree: async () => {},
    writeTicket: async () => {},
    appendLog: async () => {},
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
  assertEquals(
    makeAction().applies(makeTicket({ phase: "waiting-diff" })),
    false,
  );
});

Deno.test("checkMergedPRAction: PR not merged → null, no cleanup", async () => {
  const cleanups: string[] = [];
  const result = await makeAction({
    isPRMerged: async () => false,
    cleanupWorktree: async (wt) => {
      cleanups.push(wt.path);
    },
  }).run(makeTicket(), "/state");
  assertEquals(result, null);
  assertEquals(cleanups, []);
});

Deno.test("checkMergedPRAction: isPRMerged throws → null, no cleanup", async () => {
  const cleanups: string[] = [];
  const result = await makeAction({
    isPRMerged: async () => {
      throw new Error("network error");
    },
    cleanupWorktree: async (wt) => {
      cleanups.push(wt.path);
    },
  }).run(makeTicket(), "/state");
  assertEquals(result, null);
  assertEquals(cleanups, []);
});

Deno.test("checkMergedPRAction: PR merged → done, cleanup called per worktree", async () => {
  const cleanups: string[] = [];
  const written: string[] = [];
  const result = await makeAction({
    isPRMerged: async () => true,
    cleanupWorktree: async (wt) => {
      cleanups.push(wt.path);
    },
    writeTicket: async (_dir, t) => {
      written.push(t.phase);
    },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "done");
  assertEquals(cleanups, ["/wt/myorg/myrepo"]);
  assertEquals(written, ["done"]);
});

Deno.test("checkMergedPRAction: cleanupWorktree throws → still done", async () => {
  const written: string[] = [];
  const result = await makeAction({
    isPRMerged: async () => true,
    cleanupWorktree: async () => {
      throw new Error("git failed");
    },
    writeTicket: async (_dir, t) => {
      written.push(t.phase);
    },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "done");
  assertEquals(written, ["done"]);
});

Deno.test("checkMergedPRAction: GitHub API error logs error entry", async () => {
  const logged: object[] = [];
  const result = await makeAction({
    isPRMerged: async () => {
      throw new Error("network error");
    },
    appendLog: async (_dir, _id, entry) => {
      logged.push(entry);
    },
  }).run(makeTicket(), "/state");
  assertEquals(result, null);
  assertEquals(logged.length, 1);
  assertEquals((logged[0] as Record<string, string>).event, "error");
  assertEquals((logged[0] as Record<string, string>).context, "checkMergedPR");
  assertEquals(
    (logged[0] as Record<string, string>).message,
    "Error: network error",
  );
});

Deno.test("checkMergedPRAction: cleanup failure logs error entry", async () => {
  const logged: object[] = [];
  await makeAction({
    isPRMerged: async () => true,
    cleanupWorktree: async () => {
      throw new Error("git failed");
    },
    appendLog: async (_dir, _id, entry) => {
      logged.push(entry);
    },
  }).run(makeTicket(), "/state");
  const errorEntries = (logged as Record<string, string>[]).filter((e) =>
    e.event === "error"
  );
  assertEquals(errorEntries.length, 1);
  assertEquals(errorEntries[0].context, "checkMergedPR");
  assertEquals(errorEntries[0].message, "Error: git failed");
});

Deno.test("checkMergedPRAction: PR merged logs waiting-merge → done transition", async () => {
  const logged: object[] = [];
  await makeAction({
    isPRMerged: async () => true,
    appendLog: async (_dir, _id, entry) => {
      logged.push(entry);
    },
  }).run(makeTicket(), "/state");
  const transitions = (logged as Record<string, string>[]).filter((e) =>
    e.event === "phase-transition"
  );
  assertEquals(transitions.length, 1);
  assertEquals(transitions[0].from, "waiting-merge");
  assertEquals(transitions[0].to, "done");
});
