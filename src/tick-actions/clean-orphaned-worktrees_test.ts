import { assert, assertEquals, assertFalse } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { cleanOrphanedWorktreesAction } from "./clean-orphaned-worktrees.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-42",
    provider: "github",
    title: "T",
    url: "https://github.com/myorg/myrepo/issues/42",
    phase: "merge",
    status: "waiting",
    approvals: [],
    scope: [],
    worktrees: {
      "myorg/myrepo": { path: "/wt/myorg/myrepo", branch: "gh-42" },
    },
    prs: [],
    created: "2026-06-23T00:00:00Z",
    updated: "2026-06-23T00:00:00Z",
    body: "",
    artifact: "pr",
    ...overrides,
  };
}

function makeAction(
  overrides: Partial<Parameters<typeof cleanOrphanedWorktreesAction>[0]> = {},
) {
  return cleanOrphanedWorktreesAction({
    isProcessAlive: () => false,
    cleanupWorktree: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    ...overrides,
  });
}

// ── applies ──────────────────────────────────────────────────────────────────

Deno.test("cleanOrphanedWorktreesAction: applies when prs defined with orphaned worktree", () => {
  assert(makeAction().applies(makeTicket()));
});

Deno.test("cleanOrphanedWorktreesAction: applies for implementation/waiting phase", () => {
  assert(
    makeAction().applies(
      makeTicket({ phase: "implementation", status: "waiting" }),
    ),
  );
});

Deno.test("cleanOrphanedWorktreesAction: does not apply when prs is undefined", () => {
  assertFalse(makeAction().applies(makeTicket({ prs: undefined })));
});

Deno.test("cleanOrphanedWorktreesAction: does not apply when all worktrees have live PRs", () => {
  assertFalse(
    makeAction().applies(
      makeTicket({
        prs: [{
          url: "https://github.com/myorg/myrepo/pull/1",
          title: "feat",
          dependsOn: [],
          merged: false,
          worktreeKey: "myorg/myrepo",
        }],
      }),
    ),
  );
});

Deno.test("cleanOrphanedWorktreesAction: does not apply when phase agent is running", () => {
  assertFalse(
    makeAction({ isProcessAlive: () => true }).applies(makeTicket()),
  );
});

Deno.test("cleanOrphanedWorktreesAction: closed: true PR does not keep its worktree alive", () => {
  assert(
    makeAction().applies(
      makeTicket({
        prs: [{
          url: "https://github.com/myorg/myrepo/pull/1",
          title: "feat",
          dependsOn: [],
          merged: false,
          closed: true,
          worktreeKey: "myorg/myrepo",
        }],
      }),
    ),
  );
});

Deno.test("cleanOrphanedWorktreesAction: merged PR does not keep its worktree alive", () => {
  assert(
    makeAction().applies(
      makeTicket({
        prs: [{
          url: "https://github.com/myorg/myrepo/pull/1",
          title: "feat",
          dependsOn: [],
          merged: true,
          worktreeKey: "myorg/myrepo",
        }],
      }),
    ),
  );
});

// ── run ───────────────────────────────────────────────────────────────────────

Deno.test("cleanOrphanedWorktreesAction: removes orphaned worktree from disk and state", async () => {
  const cleanups: string[] = [];
  const written: TicketState[] = [];
  const result = await makeAction({
    cleanupWorktree: (wt) => {
      cleanups.push(wt.path);
      return Promise.resolve();
    },
    writeTicket: (_dir, t) => {
      written.push(t);
      return Promise.resolve();
    },
  }).run(makeTicket(), "/state");
  assertEquals(cleanups, ["/wt/myorg/myrepo"]);
  assertEquals(result?.worktrees["myorg/myrepo"], undefined);
  assertEquals(written.length, 1);
  assertEquals(written[0].worktrees["myorg/myrepo"], undefined);
});

Deno.test("cleanOrphanedWorktreesAction: logs orphaned-worktree-removed event", async () => {
  const logged: object[] = [];
  await makeAction({
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  }).run(makeTicket(), "/state");
  const events = (logged as Record<string, string>[]).filter((e) =>
    e.event === "orphaned-worktree-removed"
  );
  assertEquals(events.length, 1);
  assertEquals(events[0].worktreeKey, "myorg/myrepo");
  assertEquals(events[0].branch, "gh-42");
});

Deno.test(
  "cleanOrphanedWorktreesAction: cleanupWorktree throws — logs error, removes key, continues",
  async () => {
    const logged: object[] = [];
    const result = await makeAction({
      cleanupWorktree: (wt) => {
        if (wt.path === "/wt/a") throw new Error("git failed");
        return Promise.resolve();
      },
      appendLog: (_dir, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
    }).run(
      makeTicket({
        worktrees: {
          "myorg/a": { path: "/wt/a", branch: "a" },
          "myorg/b": { path: "/wt/b", branch: "b" },
        },
      }),
      "/state",
    );
    const errors = (logged as Record<string, string>[]).filter((e) =>
      e.event === "error"
    );
    assertEquals(errors.length, 1);
    assertEquals(errors[0].context, "cleanOrphanedWorktrees");
    assertEquals(errors[0].message, "Error: git failed");
    assertEquals(result?.worktrees["myorg/a"], undefined);
    assertEquals(result?.worktrees["myorg/b"], undefined);
    const removals = (logged as Record<string, string>[]).filter((e) =>
      e.event === "orphaned-worktree-removed"
    );
    assertEquals(removals.length, 2);
  },
);

Deno.test("cleanOrphanedWorktreesAction: writeTicket called exactly once", async () => {
  const writeTicketSpy = spy(() => Promise.resolve());
  await makeAction({ writeTicket: writeTicketSpy }).run(makeTicket(), "/state");
  assertSpyCalls(writeTicketSpy, 1);
});

Deno.test(
  "cleanOrphanedWorktreesAction: live open PR keeps its worktree, only orphaned key removed",
  async () => {
    const cleanups: string[] = [];
    const result = await makeAction({
      cleanupWorktree: (wt) => {
        cleanups.push(wt.path);
        return Promise.resolve();
      },
    }).run(
      makeTicket({
        worktrees: {
          "myorg/live": { path: "/wt/live", branch: "live" },
          "myorg/orphan": { path: "/wt/orphan", branch: "orphan" },
        },
        prs: [{
          url: "https://github.com/myorg/myrepo/pull/1",
          title: "live",
          dependsOn: [],
          merged: false,
          worktreeKey: "myorg/live",
        }],
      }),
      "/state",
    );
    assertEquals(cleanups, ["/wt/orphan"]);
    assert(result?.worktrees["myorg/live"] !== undefined);
    assertEquals(result?.worktrees["myorg/orphan"], undefined);
  },
);
