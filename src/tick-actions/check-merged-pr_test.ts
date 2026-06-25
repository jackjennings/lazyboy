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
