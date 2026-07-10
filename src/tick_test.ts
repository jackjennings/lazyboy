import { assertEquals } from "@std/assert";
import { advancePhase, tick } from "./tick.ts";
import { checkConflictsAction } from "./tick-actions/check-conflicts.ts";
import type { TicketState } from "./state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1",
    provider: "github",
    title: "T",
    url: "u",
    phase: "intake",
    status: "new",
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
  const ticket = makeTicket({ phase: "intake", status: "new" });
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
  const ticket = makeTicket({ phase: "intake", status: "running", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: (_dir, t) => {
      written.push(`${t.phase}/${t.status}`);
      return Promise.resolve();
    },
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(written, ["intake/waiting"]);
});

Deno.test("advancePhase: implementation running with dead PID transitions to diff/waiting", async () => {
  const written: string[] = [];
  const ticket = makeTicket({
    phase: "implementation",
    status: "running",
    pid: 999,
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: (_dir, t) => {
      written.push(`${t.phase}/${t.status}`);
      return Promise.resolve();
    },
    writePhaseOutput: async () => {},
    appendLog: async () => {},
  });
  assertEquals(written, ["diff/waiting"]);
});

Deno.test("advancePhase: running phase with live PID does nothing", async () => {
  const written: string[] = [];
  const ticket = makeTicket({ phase: "intake", status: "running", pid: 999 });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => true,
    writeTicket: (_dir, t) => {
      written.push(`${t.phase}/${t.status}`);
      return Promise.resolve();
    },
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(written, []);
});

Deno.test("advancePhase: waiting + approved advances to next phase", async () => {
  const spawned: string[] = [];
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approved: true,
  });
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
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approved: false,
  });
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

Deno.test("advancePhase: diff/waiting + approved advances to merge/waiting", async () => {
  const written: string[] = [];
  const ticket = makeTicket({
    phase: "diff",
    status: "waiting",
    approved: true,
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: (_dir, t) => {
      written.push(`${t.phase}/${t.status}`);
      return Promise.resolve();
    },
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(written, ["merge/waiting"]);
});

Deno.test("advancePhase: implementation phase receives ticket worktrees", async () => {
  const spawnedWorktrees: Record<string, unknown>[] = [];
  const ticket = makeTicket({
    phase: "plan",
    status: "waiting",
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
    phase: "intake",
    status: "waiting",
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
  const ticket = makeTicket({ phase: "intake", status: "new" });
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
    phase: "plan",
    status: "waiting",
    approved: true,
    worktrees: {},
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(1),
    isPidAlive: () => false,
    writeTicket: (_dir, t) => {
      written.push(`${t.phase}/${t.status}`);
      return Promise.resolve();
    },
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(written, ["implementation/needs-attention"]);
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
      isPidAlive: () => false,
    });
    assertEquals(installed, [["npm:pi-lens", "agent-browser"]]);
    assertEquals(sequence, ["install", "advance"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("advancePhase: new ticket logs status-only transition", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "intake", status: "new" });
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
  assertEquals(
    (logged[0] as Record<string, string>).event,
    "status-transition",
  );
  assertEquals((logged[0] as Record<string, string>).phase, "intake");
  assertEquals((logged[0] as Record<string, string>).from, "new");
  assertEquals((logged[0] as Record<string, string>).to, "running");
});

Deno.test("advancePhase: dead PID on non-impl phase logs status-only transition", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "intake", status: "running", pid: 999 });
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
  assertEquals(logged.length, 1);
  assertEquals(
    (logged[0] as Record<string, string>).event,
    "status-transition",
  );
  assertEquals((logged[0] as Record<string, string>).phase, "intake");
  assertEquals((logged[0] as Record<string, string>).from, "running");
  assertEquals((logged[0] as Record<string, string>).to, "waiting");
});

Deno.test("advancePhase: dead PID on implementation logs implementation → diff", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({
    phase: "implementation",
    status: "running",
    pid: 999,
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals(logged.length, 1);
  assertEquals((logged[0] as Record<string, string>).event, "phase-transition");
  assertEquals((logged[0] as Record<string, string>).from, "implementation");
  assertEquals((logged[0] as Record<string, string>).to, "diff");
});

Deno.test("advancePhase: live PID does not log", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "intake", status: "running", pid: 999 });
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

Deno.test("advancePhase: diff/waiting approved logs diff → merge", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({
    phase: "diff",
    status: "waiting",
    approved: true,
  });
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
  assertEquals((logged[0] as Record<string, string>).from, "diff");
  assertEquals((logged[0] as Record<string, string>).to, "merge");
});

Deno.test("advancePhase: approved waiting phase logs transition to next phase", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approved: true,
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
  assertEquals((logged[0] as Record<string, string>).from, "intake");
  assertEquals((logged[0] as Record<string, string>).to, "enrichment");
});

Deno.test("advancePhase: no worktrees logs plan → needs-attention", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({
    phase: "plan",
    status: "waiting",
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
  assertEquals((logged[0] as Record<string, string>).from, "plan");
  assertEquals((logged[0] as Record<string, string>).to, "needs-attention");
});

Deno.test("advancePhase: log entry does not include ts (appended by appendTicketLog)", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({
    phase: "diff",
    status: "waiting",
    approved: true,
  });
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

Deno.test("advancePhase: revising status spawns plan with timestamped outputFile", async () => {
  const spawnedOpts: Array<{ phase: string; outputFile?: string }> = [];
  const ticket = makeTicket({ phase: "plan", status: "revising" });
  await advancePhase(ticket, "/state", {
    spawn: (opts) => {
      spawnedOpts.push({ phase: opts.phase, outputFile: opts.outputFile });
      return Promise.resolve(77);
    },
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: async () => {},
  });
  assertEquals(spawnedOpts.length, 1);
  assertEquals(spawnedOpts[0].phase, "plan");
  assertEquals(typeof spawnedOpts[0].outputFile, "string");
  assertEquals(spawnedOpts[0].outputFile?.startsWith("plan-"), true);
  assertEquals(spawnedOpts[0].outputFile?.endsWith(".md"), true);
});

Deno.test("advancePhase: revising status transitions to running and clears approved", async () => {
  const written: Partial<TicketState>[] = [];
  const ticket = makeTicket({
    phase: "plan",
    status: "revising",
    approved: true,
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(77),
    isPidAlive: () => false,
    writeTicket: (_dir, t) => {
      written.push({
        phase: t.phase,
        status: t.status,
        approved: t.approved,
        pid: t.pid,
      });
      return Promise.resolve();
    },
    writePhaseOutput: async () => {},
    appendLog: async () => {},
  });
  assertEquals(written.length, 1);
  assertEquals(written[0].phase, "plan");
  assertEquals(written[0].status, "running");
  assertEquals(written[0].approved, false);
  assertEquals(written[0].pid, 77);
});

Deno.test("advancePhase: revising status logs status-transition from revising to running", async () => {
  const logged: object[] = [];
  const ticket = makeTicket({ phase: "enrichment", status: "revising" });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(5),
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: (_dir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  });
  assertEquals(
    (logged[0] as Record<string, string>).event,
    "status-transition",
  );
  assertEquals((logged[0] as Record<string, string>).phase, "enrichment");
  assertEquals((logged[0] as Record<string, string>).from, "revising");
  assertEquals((logged[0] as Record<string, string>).to, "running");
});

Deno.test("advancePhase: revising outputFile uses YYYY-MM-DDTHHMMSS date format", async () => {
  const spawnedOpts: Array<{ outputFile?: string }> = [];
  const ticket = makeTicket({ phase: "plan", status: "revising" });
  await advancePhase(ticket, "/state", {
    spawn: (opts) => {
      spawnedOpts.push({ outputFile: opts.outputFile });
      return Promise.resolve(77);
    },
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: async () => {},
  });
  assertEquals(spawnedOpts.length, 1);
  const file = spawnedOpts[0].outputFile ?? "";
  assertEquals(/^plan-\d{4}-\d{2}-\d{2}T\d{6}\.md$/.test(file), true);
});

Deno.test("checkConflictsAction is importable (wiring smoke test)", () => {
  const action = checkConflictsAction({
    runGit: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    isPidAlive: () => false,
    worktreeExists: () => true,
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertEquals(typeof action.applies, "function");
  assertEquals(typeof action.run, "function");
});
