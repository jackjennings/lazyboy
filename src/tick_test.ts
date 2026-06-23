import { assertEquals } from "jsr:@std/assert";
import { advancePhase } from "./tick.ts";
import type { TicketState } from "./state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1", provider: "github", title: "T", url: "u",
    phase: "new", approved: false, scope: [], worktrees: {},
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
    writeTicket: async (_dir, t) => { written.push(t.phase); },
    writePhaseOutput: async () => {},
  });
  assertEquals(written, ["waiting-intake"]);
});

Deno.test("advancePhase: running phase with live PID does nothing", async () => {
  const written: string[] = [];
  const ticket = makeTicket({ phase: "running-intake", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: async () => 0,
    isPidAlive: () => true,
    writeTicket: async (_dir, t) => { written.push(t.phase); },
    writePhaseOutput: async () => {},
  });
  assertEquals(written, []);
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

Deno.test("advancePhase: waiting + not approved does nothing", async () => {
  const spawned: string[] = [];
  const ticket = makeTicket({ phase: "waiting-intake", approved: false });
  await advancePhase(ticket, "/state", {
    spawn: async (opts) => { spawned.push(opts.phase); return 1; },
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
  });
  assertEquals(spawned, []);
});

Deno.test("advancePhase: waiting-diff approved advances to waiting-merge", async () => {
  const written: string[] = [];
  const ticket = makeTicket({ phase: "waiting-diff", approved: true });
  await advancePhase(ticket, "/state", {
    spawn: async () => 0,
    isPidAlive: () => false,
    writeTicket: async (_dir, t) => { written.push(t.phase); },
    writePhaseOutput: async () => {},
  });
  assertEquals(written, ["waiting-merge"]);
});
