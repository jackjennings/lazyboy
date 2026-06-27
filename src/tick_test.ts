import { assertEquals } from "@std/assert";
import { advancePhase, tick } from "./tick.ts";
import type { Phase, TicketState } from "./state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1",
    provider: "github",
    title: "T",
    url: "u",
    phase: "new",
    approved: false,
    scope: [],
    worktrees: {},
    created: "2026-06-15T00:00:00Z",
    updated: "2026-06-15T00:00:00Z",
    body: "",
    ...overrides,
  };
}

Deno.test("advancePhase: new ticket starts intake", async () => {
  const spawned: string[] = [];
  const ticket = makeTicket({ phase: "new" });
  await advancePhase(ticket, "/state", {
    spawn: (_opts) => {
      spawned.push("intake");
      return Promise.resolve(123);
    },
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(spawned, ["intake"]);
});

Deno.test("advancePhase: running phase with dead PID sets waiting", async () => {
  const written: string[] = [];
  const ticket = makeTicket({ phase: "running-intake", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: (_dir, t) => {
      written.push(t.phase);
      return Promise.resolve();
    },
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(written, ["waiting-intake"]);
});

Deno.test("advancePhase: running phase with live PID does nothing", async () => {
  const written: string[] = [];
  const ticket = makeTicket({ phase: "running-intake", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => true,
    writeTicket: (_dir, t) => {
      written.push(t.phase);
      return Promise.resolve();
    },
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(written, []);
});

Deno.test("advancePhase: waiting + approved advances to next phase", async () => {
  const spawned: string[] = [];
  const ticket = makeTicket({ phase: "waiting-intake", approved: true });
  await advancePhase(ticket, "/state", {
    spawn: (opts) => {
      spawned.push(opts.phase);
      return Promise.resolve(1);
    },
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(spawned, ["enrichment"]);
});

Deno.test("advancePhase: waiting + not approved does nothing", async () => {
  const spawned: string[] = [];
  const ticket = makeTicket({ phase: "waiting-intake", approved: false });
  await advancePhase(ticket, "/state", {
    spawn: (opts) => {
      spawned.push(opts.phase);
      return Promise.resolve(1);
    },
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(spawned, []);
});

Deno.test("advancePhase: waiting-diff approved advances to waiting-merge", async () => {
  const written: string[] = [];
  const ticket = makeTicket({ phase: "waiting-diff", approved: true });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: (_dir, t) => {
      written.push(t.phase);
      return Promise.resolve();
    },
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(written, ["waiting-merge"]);
});

Deno.test("advancePhase: implementation phase receives ticket worktrees", async () => {
  const spawnedWorktrees: Record<string, unknown>[] = [];
  const ticket = makeTicket({
    phase: "waiting-plan",
    approved: true,
    worktrees: { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" } },
  });
  await advancePhase(ticket, "/state", {
    spawn: (opts) => {
      spawnedWorktrees.push(opts.worktrees);
      return Promise.resolve(1);
    },
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(spawnedWorktrees, [
    { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" } },
  ]);
});

Deno.test("advancePhase: non-implementation phases receive empty worktrees", async () => {
  const spawnedWorktrees: Record<string, unknown>[] = [];
  const ticket = makeTicket({
    phase: "waiting-intake",
    approved: true,
    worktrees: { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" } },
  });
  await advancePhase(ticket, "/state", {
    spawn: (opts) => {
      spawnedWorktrees.push(opts.worktrees);
      return Promise.resolve(1);
    },
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(spawnedWorktrees, [{}]);
});

Deno.test("advancePhase: new ticket spawn receives empty worktrees", async () => {
  const spawnedWorktrees: Record<string, unknown>[] = [];
  const ticket = makeTicket({ phase: "new" });
  await advancePhase(ticket, "/state", {
    spawn: (opts) => {
      spawnedWorktrees.push(opts.worktrees);
      return Promise.resolve(123);
    },
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(spawnedWorktrees, [{}]);
});

Deno.test("advancePhase: implementation phase with empty worktrees transitions to needs-attention", async () => {
  const written: string[] = [];
  const ticket = makeTicket({
    phase: "waiting-plan",
    approved: true,
    worktrees: {},
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(1),
    isPidAlive: () => false,
    writeTicket: (_dir, t) => {
      written.push(t.phase);
      return Promise.resolve();
    },
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(written, ["needs-attention"]);
});

Deno.test("tick: calls installPackages with config.packages.enabled before advancing", async () => {
  const sequence: string[] = [];
  const installed: string[][] = [];
  const tempDir = await Deno.makeTempDir();
  try {
    await tick({
      loadConfig: () =>
        Promise.resolve({
          github: { repos: [] },
          state: { dir: tempDir },
          tick: { concurrency: 1 },
          codebase: { roots: [] },
          packages: { enabled: ["npm:pi-lens", "agent-browser"] },
        }),
      installPackages: (sources) => {
        sequence.push("install");
        installed.push(sources);
        return Promise.resolve([]);
      },
      advanceTickets: () => {
        sequence.push("advance");
        return Promise.resolve();
      },
    });
    assertEquals(installed, [["npm:pi-lens", "agent-browser"]]);
    assertEquals(sequence, ["install", "advance"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("advancePhase: new ticket logs new → running-intake transition", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "new" });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(123),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals(logged.length, 1);
  assertEquals((logged[0] as Record<string, string>).event, "phase-transition");
  assertEquals((logged[0] as Record<string, string>).from, "new");
  assertEquals((logged[0] as Record<string, string>).to, "running-intake");
});

Deno.test("advancePhase: dead PID logs running → waiting transition", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "running-intake", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals((logged[0] as Record<string, string>).event, "phase-transition");
  assertEquals((logged[0] as Record<string, string>).from, "running-intake");
  assertEquals((logged[0] as Record<string, string>).to, "waiting-intake");
});

Deno.test("advancePhase: live PID does not log", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "running-intake", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => true,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals(logged, []);
});

Deno.test("advancePhase: waiting-diff approved logs waiting-diff → waiting-merge", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "waiting-diff", approved: true });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals((logged[0] as Record<string, string>).from, "waiting-diff");
  assertEquals((logged[0] as Record<string, string>).to, "waiting-merge");
});

Deno.test("advancePhase: approved waiting phase logs transition to running-next", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "waiting-intake", approved: true });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(1),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals((logged[0] as Record<string, string>).from, "waiting-intake");
  assertEquals((logged[0] as Record<string, string>).to, "running-enrichment");
});

Deno.test("advancePhase: no worktrees logs waiting-plan → needs-attention", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({
    phase: "waiting-plan",
    approved: true,
    worktrees: {},
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(1),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals((logged[0] as Record<string, string>).from, "waiting-plan");
  assertEquals((logged[0] as Record<string, string>).to, "needs-attention");
});

Deno.test("advancePhase: next=done fallthrough logs current → waiting-merge", async () => {
  const logged: object[] = [];
  const written: string[] = [];
  const ticket = makeTicket({
    phase: "waiting-implementation" as Phase,
    approved: true,
    worktrees: { "x": { path: "/p", branch: "b" } },
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(1),
    isPidAlive: () => false,
    writeTicket: (_dir, t) => {
      written.push(t.phase);
      return Promise.resolve();
    },
    writePhaseOutput: () => Promise.resolve(),
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals(written, ["waiting-merge"]);
  assertEquals(
    (logged[0] as Record<string, string>).from,
    "waiting-implementation",
  );
  assertEquals((logged[0] as Record<string, string>).to, "waiting-merge");
});

Deno.test("advancePhase: log entry does not include ts (appended by appendTicketLog)", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "new" });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(123),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals("ts" in (logged[0] as Record<string, unknown>), false);
});
