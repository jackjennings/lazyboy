import { assertEquals } from "@std/assert";
import { checkMergedPRAction } from "./check-merged-pr.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-42",
    provider: "github",
    title: "T",
    url: "https://github.com/myorg/myrepo/issues/42",
    phase: "merge",
    status: "waiting",
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
    isPRMerged: () => Promise.resolve(false),
    cleanupWorktree: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    ...overrides,
  });
}

Deno.test("checkMergedPRAction: applies when merge/waiting with prUrl", () => {
  assertEquals(makeAction().applies(makeTicket()), true);
});

Deno.test("checkMergedPRAction: does not apply when prUrl absent", () => {
  assertEquals(makeAction().applies(makeTicket({ prUrl: undefined })), false);
});

Deno.test("checkMergedPRAction: does not apply when not merge/waiting", () => {
  assertEquals(
    makeAction().applies(makeTicket({ phase: "diff", status: "waiting" })),
    false,
  );
});

Deno.test("checkMergedPRAction: PR not merged → null, no cleanup", async () => {
  const cleanups: string[] = [];
  const result = await makeAction({
    isPRMerged: () => Promise.resolve(false),
    cleanupWorktree: (wt) => {
      cleanups.push(wt.path);
      return Promise.resolve();
    },
  }).run(makeTicket(), "/state");
  assertEquals(result, null);
  assertEquals(cleanups, []);
});

Deno.test("checkMergedPRAction: isPRMerged throws → null, no cleanup", async () => {
  const cleanups: string[] = [];
  const result = await makeAction({
    isPRMerged: () => {
      throw new Error("network error");
    },
    cleanupWorktree: (wt) => {
      cleanups.push(wt.path);
      return Promise.resolve();
    },
  }).run(makeTicket(), "/state");
  assertEquals(result, null);
  assertEquals(cleanups, []);
});

Deno.test("checkMergedPRAction: PR merged → done, cleanup called per worktree", async () => {
  const cleanups: string[] = [];
  const written: string[] = [];
  const result = await makeAction({
    isPRMerged: () => Promise.resolve(true),
    cleanupWorktree: (wt) => {
      cleanups.push(wt.path);
      return Promise.resolve();
    },
    writeTicket: (_dir, t) => {
      written.push(t.status);
      return Promise.resolve();
    },
  }).run(makeTicket(), "/state");
  assertEquals(result?.status, "done");
  assertEquals(cleanups, ["/wt/myorg/myrepo"]);
  assertEquals(written, ["done"]);
});

Deno.test("checkMergedPRAction: cleanupWorktree throws → still done", async () => {
  const written: string[] = [];
  const result = await makeAction({
    isPRMerged: () => Promise.resolve(true),
    cleanupWorktree: () => {
      throw new Error("git failed");
    },
    writeTicket: (_dir, t) => {
      written.push(t.status);
      return Promise.resolve();
    },
  }).run(makeTicket(), "/state");
  assertEquals(result?.status, "done");
  assertEquals(written, ["done"]);
});

Deno.test("checkMergedPRAction: GitHub API error logs error entry", async () => {
  const logged: object[] = [];
  const result = await makeAction({
    isPRMerged: () => {
      throw new Error("network error");
    },
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
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
    isPRMerged: () => Promise.resolve(true),
    cleanupWorktree: () => {
      throw new Error("git failed");
    },
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
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
    isPRMerged: () => Promise.resolve(true),
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  }).run(makeTicket(), "/state");
  const transitions = (logged as Record<string, string>[]).filter((e) =>
    e.event === "phase-transition"
  );
  assertEquals(transitions.length, 1);
  assertEquals(transitions[0].from, "waiting-merge");
  assertEquals(transitions[0].to, "done");
});
