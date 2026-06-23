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
    writeTicket: async (_dir: string, t: TicketState) => { written.push(t.phase); },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "needs-attention");
  assertEquals(written, ["needs-attention"]);
});

Deno.test("createWorktreeAction: createWorktree throws → needs-attention", async () => {
  const written: string[] = [];
  const result = await makeAction({
    findLocalRepo: async () => "/code/myrepo",
    createWorktree: async () => { throw new Error("git failed"); },
    writeTicket: async (_dir: string, t: TicketState) => { written.push(t.phase); },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "needs-attention");
  assertEquals(written, ["needs-attention"]);
});

Deno.test("createWorktreeAction: success → worktrees populated, phase stays new", async () => {
  const written: TicketState[] = [];
  const result = await makeAction({
    findLocalRepo: async () => "/code/myrepo",
    createWorktree: async () => ({ path: "/wt/myorg/myrepo", branch: "gh-1" }),
    writeTicket: async (_dir: string, t: TicketState) => { written.push(t); },
  }).run(makeTicket(), "/state");
  assertEquals(result?.phase, "new");
  assertEquals(result?.worktrees, { "myorg/myrepo": { path: "/wt/myorg/myrepo", branch: "gh-1" } });
  assertEquals(written.length, 1);
});
