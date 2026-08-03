import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { join } from "@std/path";
import { writeTicket } from "../state/store.ts";
import type { TicketState } from "../state/types.ts";
import { performApprove } from "./approve.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "github/test/repo/1",
    provider: "github",
    title: "Test ticket",
    url: "https://github.com/test/repo/issues/1",
    phase: "intake",
    status: "waiting",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    body: "Body",
    ...overrides,
  };
}

Deno.test(
  "performApprove: appends entry with actor human and current phase",
  async () => {
    const ticket = makeTicket({ phase: "enrichment", status: "waiting" });
    const stateDir = await Deno.makeTempDir();
    await writeTicket(stateDir, ticket);
    const commitFn = spy(() => Promise.resolve());
    try {
      await performApprove(stateDir, ticket.id, commitFn);
      const meta = await Deno.readTextFile(
        join(stateDir, ticket.id, "meta.md"),
      );
      assertStringIncludes(meta, "actor: human");
      assertStringIncludes(meta, "phase: enrichment");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test("performApprove: does not write approved key", async () => {
  const ticket = makeTicket({ phase: "intake", status: "waiting" });
  const stateDir = await Deno.makeTempDir();
  await writeTicket(stateDir, ticket);
  const commitFn = spy(() => Promise.resolve());
  try {
    await performApprove(stateDir, ticket.id, commitFn);
    const meta = await Deno.readTextFile(
      join(stateDir, ticket.id, "meta.md"),
    );
    assertFalse(meta.includes("approved:"));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("performApprove: accumulates multiple approvals", async () => {
  const ticket = makeTicket({
    phase: "spec",
    status: "waiting",
    approvals: [{
      timestamp: "2026-01-01T00:00:00Z",
      actor: "agent",
      phase: "intake",
    }],
  });
  const stateDir = await Deno.makeTempDir();
  await writeTicket(stateDir, ticket);
  const commitFn = spy(() => Promise.resolve());
  try {
    await performApprove(stateDir, ticket.id, commitFn);
    const meta = await Deno.readTextFile(
      join(stateDir, ticket.id, "meta.md"),
    );
    assertStringIncludes(meta, "actor: agent");
    assertStringIncludes(meta, "actor: human");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test(
  "performApprove: calls commitFn with stateDir, id, and approve message",
  async () => {
    const ticket = makeTicket({ phase: "plan", status: "waiting" });
    const stateDir = await Deno.makeTempDir();
    await writeTicket(stateDir, ticket);
    const commitFn = spy(() => Promise.resolve());
    try {
      await performApprove(stateDir, ticket.id, commitFn);
      assertSpyCalls(commitFn, 1);
      assertEquals(commitFn.calls[0].args, [
        stateDir,
        ticket.id,
        `approve: ${ticket.id}`,
      ]);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);
