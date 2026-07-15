import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { join } from "@std/path";
import {
  advancePhase,
  advanceTickets,
  selectCandidates,
  tick,
} from "./tick.ts";
import { checkConflictsAction } from "./tick-actions/check-conflicts.ts";
import { writeTicket } from "./state/store.ts";
import type { TickDeps } from "./tick.ts";
import type { TicketState } from "./state/types.ts";
import type { MigrationFn } from "./migrations/runner.ts";

type SpawnOpts = Parameters<TickDeps["spawn"]>[0];

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
  const ticket = makeTicket({ phase: "intake", status: "new" });
  let spawnedPhase = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedPhase = opts.phase;
    return Promise.resolve(123);
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedPhase, "intake");
});

Deno.test("advancePhase: running phase with dead PID sets waiting", async () => {
  const ticket = makeTicket({ phase: "intake", status: "running", pid: 999 });
  let written = { phase: "", status: "" };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = { phase: t.phase, status: t.status };
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "intake");
  assertEquals(written.status, "waiting");
});

Deno.test("advancePhase: implementation running with dead PID transitions to implementation/waiting", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "running",
    pid: 999,
  });
  let written = { phase: "", status: "" };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = { phase: t.phase, status: t.status };
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: async () => {},
    appendLog: async () => {},
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "implementation");
  assertEquals(written.status, "waiting");
});

Deno.test("advancePhase: running phase with live PID does nothing", async () => {
  const ticket = makeTicket({ phase: "intake", status: "running", pid: 999 });
  const writeTicketSpy = spy((_dir: string, _t: TicketState) =>
    Promise.resolve()
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => true,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCalls(writeTicketSpy, 0);
});

Deno.test("advancePhase: waiting + approved advances to next phase", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approved: true,
  });
  let spawnedPhase = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedPhase = opts.phase;
    return Promise.resolve(1);
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedPhase, "enrichment");
});

Deno.test("advancePhase: waiting + not approved does nothing", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approved: false,
  });
  const spawnSpy = spy((_opts: SpawnOpts) => Promise.resolve(1));
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCalls(spawnSpy, 0);
});

Deno.test("advancePhase: implementation/waiting + approved advances to merge/waiting", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "waiting",
    approved: true,
  });
  let written = { phase: "", status: "" };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = { phase: t.phase, status: t.status };
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "merge");
  assertEquals(written.status, "waiting");
});

Deno.test("advancePhase: implementation phase receives ticket worktrees", async () => {
  const ticket = makeTicket({
    phase: "plan",
    status: "waiting",
    approved: true,
    worktrees: { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" } },
  });
  let spawnedWorktrees: Record<string, unknown> = {};
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedWorktrees = opts.worktrees;
    return Promise.resolve(1);
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedWorktrees, {
    "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" },
  });
});

Deno.test("advancePhase: non-implementation phases receive empty worktrees", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approved: true,
    worktrees: { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" } },
  });
  let spawnedWorktrees: Record<string, unknown> = {};
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedWorktrees = opts.worktrees;
    return Promise.resolve(1);
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedWorktrees, {});
});

Deno.test("advancePhase: new ticket spawn receives empty worktrees", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  let spawnedWorktrees: Record<string, unknown> = {};
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedWorktrees = opts.worktrees;
    return Promise.resolve(123);
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedWorktrees, {});
});

Deno.test("advancePhase: implementation phase with empty worktrees transitions to needs-attention", async () => {
  const ticket = makeTicket({
    phase: "plan",
    status: "waiting",
    approved: true,
    worktrees: {},
  });
  let written = { phase: "", status: "" };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = { phase: t.phase, status: t.status };
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(1),
    isPidAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "implementation");
  assertEquals(written.status, "needs-attention");
});

Deno.test("tick: calls installPackages with config.packages.enabled before advancing", async () => {
  const sequence: string[] = [];
  const tempDir = await Deno.makeTempDir();
  try {
    const installPackagesSpy = spy(() => {
      sequence.push("install");
      return Promise.resolve([]);
    });
    const advanceTicketsSpy = spy(() => {
      sequence.push("advance");
      return Promise.resolve();
    });
    await tick({
      loadConfig: () =>
        Promise.resolve({
          github: { repos: [] },
          state: { dir: tempDir },
          tick: { concurrency: 1 },
          codebase: { roots: [] },
          packages: { enabled: ["npm:pi-lens", "agent-browser"] },
        }),
      installPackages: installPackagesSpy,
      advanceTickets: advanceTicketsSpy,
      isPidAlive: () => false,
    });
    assertSpyCall(installPackagesSpy, 0, {
      args: [["npm:pi-lens", "agent-browser"]],
    });
    assertEquals(sequence, ["install", "advance"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("advancePhase: new ticket logs status-only transition", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(123),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
  });
  assertSpyCall(appendLogSpy, 0, {
    args: ["/state", "gh-1", {
      event: "status-transition",
      phase: "intake",
      from: "new",
      to: "running",
    }],
  });
});

Deno.test("advancePhase: dead PID on non-impl phase logs status-only transition", async () => {
  const ticket = makeTicket({ phase: "intake", status: "running", pid: 999 });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
  });
  assertSpyCall(appendLogSpy, 0, {
    args: ["/state", "gh-1", {
      event: "status-transition",
      phase: "intake",
      from: "running",
      to: "waiting",
    }],
  });
});

Deno.test("advancePhase: dead PID on implementation logs status-transition to waiting", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "running",
    pid: 999,
  });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: appendLogSpy,
  });
  assertSpyCall(appendLogSpy, 0, {
    args: ["/state", "gh-1", {
      event: "status-transition",
      phase: "implementation",
      from: "running",
      to: "waiting",
    }],
  });
});

Deno.test("advancePhase: live PID does not log", async () => {
  const ticket = makeTicket({ phase: "intake", status: "running", pid: 999 });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => true,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
  });
  assertSpyCalls(appendLogSpy, 0);
});

Deno.test("advancePhase: implementation/waiting approved logs implementation → merge", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "waiting",
    approved: true,
  });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(0),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
  });
  assertSpyCall(appendLogSpy, 0, {
    args: ["/state", "gh-1", {
      event: "phase-transition",
      from: "implementation",
      to: "merge",
    }],
  });
});

Deno.test("advancePhase: approved waiting phase logs transition to next phase", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approved: true,
  });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(1),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
  });
  assertSpyCall(appendLogSpy, 0, {
    args: ["/state", "gh-1", {
      event: "phase-transition",
      from: "intake",
      to: "enrichment",
    }],
  });
});

Deno.test("advancePhase: no worktrees logs plan → needs-attention", async () => {
  const ticket = makeTicket({
    phase: "plan",
    status: "waiting",
    approved: true,
    worktrees: {},
  });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(1),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
  });
  assertSpyCall(appendLogSpy, 0, {
    args: ["/state", "gh-1", {
      event: "phase-transition",
      from: "plan",
      to: "needs-attention",
    }],
  });
});

Deno.test("advancePhase: log entry does not include ts (appended by appendTicketLog)", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "waiting",
    approved: true,
  });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(123),
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
  });
  assertSpyCall(appendLogSpy, 0);
  assertEquals(
    "ts" in (appendLogSpy.calls[0].args[2] as Record<string, unknown>),
    false,
  );
});

Deno.test("advancePhase: revising status spawns plan with timestamped outputFile", async () => {
  const ticket = makeTicket({ phase: "plan", status: "revising" });
  let spawnedPhase = "";
  let spawnedOutputFile: string | undefined;
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedPhase = opts.phase;
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve(77);
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: async () => {},
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedPhase, "plan");
  assertEquals(/^\d{8}T\d{6}-plan\.md$/.test(spawnedOutputFile ?? ""), true);
});

Deno.test("advancePhase: revising status transitions to running and clears approved", async () => {
  const ticket = makeTicket({
    phase: "plan",
    status: "revising",
    approved: true,
  });
  let written = {
    phase: "",
    status: "",
    approved: true,
    pid: undefined as number | undefined,
  };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = {
      phase: t.phase,
      status: t.status,
      approved: t.approved,
      pid: t.pid,
    };
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(77),
    isPidAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: async () => {},
    appendLog: async () => {},
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "plan");
  assertEquals(written.status, "running");
  assertEquals(written.approved, false);
  assertEquals(written.pid, 77);
});

Deno.test("advancePhase: revising status logs status-transition from revising to running", async () => {
  const ticket = makeTicket({ phase: "enrichment", status: "revising" });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(5),
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: appendLogSpy,
  });
  assertSpyCall(appendLogSpy, 0, {
    args: ["/state", "gh-1", {
      event: "status-transition",
      phase: "enrichment",
      from: "revising",
      to: "running",
    }],
  });
});

Deno.test("advancePhase: revising outputFile uses YYYYMMDDTHHMMSS prefix format", async () => {
  const ticket = makeTicket({ phase: "plan", status: "revising" });
  let spawnedOutputFile: string | undefined;
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve(77);
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: async () => {},
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(
    /^\d{8}T\d{6}-plan\.md$/.test(spawnedOutputFile ?? ""),
    true,
  );
});

Deno.test("advancePhase: new status spawn receives timestamp-prefixed intake output filename", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  let spawnedOutputFile: string | undefined;
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve(123);
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(/^\d{8}T\d{6}-intake\.md$/.test(spawnedOutputFile ?? ""), true);
});

Deno.test("advancePhase: waiting+approved spawn receives timestamp-prefixed next-phase output filename", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approved: true,
  });
  let spawnedOutputFile: string | undefined;
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve(1);
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isPidAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(
    /^\d{8}T\d{6}-enrichment\.md$/.test(spawnedOutputFile ?? ""),
    true,
  );
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

async function initGitStateDir(dir: string): Promise<void> {
  const run = (args: string[]) =>
    new Deno.Command("git", { args, cwd: dir }).output();
  await run(["init"]);
  await run(["config", "user.email", "test@test.com"]);
  await run(["config", "user.name", "Test"]);
}

async function writeMinimalTicket(stateDir: string, id: string): Promise<void> {
  await Deno.mkdir(join(stateDir, id), { recursive: true });
  await Deno.writeTextFile(
    join(stateDir, id, "meta.md"),
    [
      "---",
      `id: ${id}`,
      "provider: github",
      "title: T",
      "url: 'https://github.com/test/repo/issues/1'",
      "phase: intake",
      "status: new",
      "approved: false",
      "scope: []",
      "worktrees: {}",
      "created: '2026-01-01T00:00:00Z'",
      "updated: '2026-01-01T00:00:00Z'",
      "---",
      "",
    ].join("\n"),
  );
}

Deno.test("advanceTicketsImpl: runMigrations receives the ticket list before tick actions run", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await initGitStateDir(tempDir);
    await writeMinimalTicket(tempDir, "gh-1");
    let capturedIds: string[] = [];
    const runMigrationsSpy = spy(
      (_stateDir: string, tickets: TicketState[]) => {
        capturedIds = tickets.map((t) => t.id);
        return Promise.resolve(tickets);
      },
    );
    await advanceTickets(
      {
        github: { repos: [] },
        state: { dir: tempDir },
        tick: { concurrency: 0 },
        codebase: { roots: [] },
        packages: { enabled: [] },
      },
      {
        runMigrations: runMigrationsSpy,
        readLastWorked: () => Promise.resolve([]),
        writeLastWorked: async () => {},
      },
    );
    assertSpyCall(runMigrationsSpy, 0);
    assertEquals(capturedIds, ["gh-1"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("advanceTicketsImpl: throws when runMigrations throws, halting the tick", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await initGitStateDir(tempDir);
    await writeMinimalTicket(tempDir, "gh-1");
    const runMigrations: MigrationFn = () =>
      Promise.reject(
        new Error("Migration 1000-fail.ts failed on ticket gh-1: bad data"),
      );
    await assertRejects(
      () =>
        advanceTickets(
          {
            github: { repos: [] },
            state: { dir: tempDir },
            tick: { concurrency: 0 },
            codebase: { roots: [] },
            packages: { enabled: [] },
          },
          {
            runMigrations,
            readLastWorked: () => Promise.resolve([]),
            writeLastWorked: async () => {},
          },
        ),
      Error,
      "Migration 1000-fail.ts failed on ticket gh-1: bad data",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selectCandidates: empty candidates returns empty", () => {
  assertEquals(selectCandidates([], [], 2), []);
});

Deno.test("selectCandidates: no lastWorked starts at index 0", () => {
  assertEquals(selectCandidates(["gh-1", "gh-2", "gh-3"], [], 2), [
    "gh-1",
    "gh-2",
  ]);
});

Deno.test("selectCandidates: lastWorked anchor advances start by one", () => {
  assertEquals(
    selectCandidates(["gh-1", "gh-2", "gh-3", "gh-4", "gh-5"], ["gh-2"], 2),
    ["gh-3", "gh-4"],
  );
});

Deno.test("selectCandidates: anchor at last element wraps to index 0", () => {
  assertEquals(selectCandidates(["gh-1", "gh-2", "gh-3"], ["gh-3"], 2), [
    "gh-1",
    "gh-2",
  ]);
});

Deno.test("selectCandidates: wrapping selection spans end and start of list", () => {
  assertEquals(
    selectCandidates(["gh-1", "gh-2", "gh-3", "gh-4", "gh-5"], ["gh-4"], 3),
    ["gh-5", "gh-1", "gh-2"],
  );
});

Deno.test("selectCandidates: concurrency larger than candidates returns all", () => {
  assertEquals(selectCandidates(["gh-1", "gh-2"], [], 10), ["gh-1", "gh-2"]);
});

Deno.test("selectCandidates: all lastWorked IDs absent from candidates starts at 0", () => {
  assertEquals(
    selectCandidates(["gh-1", "gh-3", "gh-5"], ["gh-2", "gh-4"], 2),
    ["gh-1", "gh-3"],
  );
});

Deno.test("selectCandidates: uses last surviving ID from end of lastWorked as anchor", () => {
  assertEquals(
    selectCandidates(["gh-1", "gh-2", "gh-3"], ["gh-1", "gh-99", "gh-2"], 1),
    ["gh-3"],
  );
});

// Task 2 integration tests

Deno.test(
  "advanceTicketsImpl: writeLastWorked called with sorted candidate IDs",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await new Deno.Command("git", { args: ["init", tempDir] }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.email", "t@t"],
      }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.name", "t"],
      }).output();

      await writeTicket(
        tempDir,
        makeTicket({
          id: "gh-2",
          phase: "intake",
          status: "waiting",
          approved: false,
        }),
      );
      await writeTicket(
        tempDir,
        makeTicket({
          id: "gh-1",
          phase: "intake",
          status: "waiting",
          approved: false,
        }),
      );
      await writeTicket(
        tempDir,
        makeTicket({
          id: "gh-3",
          phase: "intake",
          status: "running",
          pid: Deno.pid,
        }),
      );

      const writeLastWorked = spy((_ids: string[]) => Promise.resolve());
      await advanceTickets(
        {
          github: { repos: [] },
          state: { dir: tempDir },
          tick: { concurrency: 1 },
          codebase: { roots: [] },
          packages: { enabled: [] },
        },
        {
          runMigrations: (_, tickets) => Promise.resolve(tickets),
          readLastWorked: () => Promise.resolve([]),
          writeLastWorked,
        },
      );

      assertSpyCall(writeLastWorked, 0, { args: [["gh-1"]] });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "advanceTicketsImpl: running tickets excluded from writeLastWorked",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await new Deno.Command("git", { args: ["init", tempDir] }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.email", "t@t"],
      }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.name", "t"],
      }).output();

      await writeTicket(
        tempDir,
        makeTicket({
          id: "gh-1",
          phase: "intake",
          status: "running",
          pid: Deno.pid,
        }),
      );
      await writeTicket(
        tempDir,
        makeTicket({
          id: "gh-2",
          phase: "intake",
          status: "waiting",
          approved: false,
        }),
      );

      const writeLastWorked = spy((_ids: string[]) => Promise.resolve());
      await advanceTickets(
        {
          github: { repos: [] },
          state: { dir: tempDir },
          tick: { concurrency: 2 },
          codebase: { roots: [] },
          packages: { enabled: [] },
        },
        {
          runMigrations: (_, tickets) => Promise.resolve(tickets),
          readLastWorked: () => Promise.resolve([]),
          writeLastWorked,
        },
      );

      assertSpyCall(writeLastWorked, 0, { args: [["gh-2"]] });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "advanceTicketsImpl: writeLastWorked called with empty array when no candidates",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await new Deno.Command("git", { args: ["init", tempDir] }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.email", "t@t"],
      }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.name", "t"],
      }).output();

      await writeTicket(
        tempDir,
        makeTicket({
          id: "gh-1",
          phase: "intake",
          status: "running",
          pid: Deno.pid,
        }),
      );

      const writeLastWorked = spy((_ids: string[]) => Promise.resolve());
      await advanceTickets(
        {
          github: { repos: [] },
          state: { dir: tempDir },
          tick: { concurrency: 2 },
          codebase: { roots: [] },
          packages: { enabled: [] },
        },
        {
          runMigrations: (_, tickets) => Promise.resolve(tickets),
          readLastWorked: () => Promise.resolve([]),
          writeLastWorked,
        },
      );

      assertSpyCall(writeLastWorked, 0, { args: [[]] });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "advanceTicketsImpl: readLastWorked shifts round-robin start position",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await new Deno.Command("git", { args: ["init", tempDir] }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.email", "t@t"],
      }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.name", "t"],
      }).output();

      await writeTicket(
        tempDir,
        makeTicket({
          id: "gh-1",
          phase: "intake",
          status: "waiting",
          approved: false,
        }),
      );
      await writeTicket(
        tempDir,
        makeTicket({
          id: "gh-2",
          phase: "intake",
          status: "waiting",
          approved: false,
        }),
      );
      await writeTicket(
        tempDir,
        makeTicket({
          id: "gh-3",
          phase: "intake",
          status: "waiting",
          approved: false,
        }),
      );

      const writeLastWorked = spy((_ids: string[]) => Promise.resolve());
      await advanceTickets(
        {
          github: { repos: [] },
          state: { dir: tempDir },
          tick: { concurrency: 1 },
          codebase: { roots: [] },
          packages: { enabled: [] },
        },
        {
          runMigrations: (_, tickets) => Promise.resolve(tickets),
          readLastWorked: () => Promise.resolve(["gh-1"]),
          writeLastWorked,
        },
      );

      assertSpyCall(writeLastWorked, 0, { args: [["gh-2"]] });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "advanceTicketsImpl: skipped-status tickets not included in candidates or writeLastWorked",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await new Deno.Command("git", { args: ["init", tempDir] }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.email", "t@t"],
      }).output();
      await new Deno.Command("git", {
        args: ["-C", tempDir, "config", "user.name", "t"],
      }).output();

      await writeTicket(
        tempDir,
        makeTicket({ id: "gh-1", phase: "merge", status: "done" }),
      );
      await writeTicket(
        tempDir,
        makeTicket({ id: "gh-2", phase: "intake", status: "needs-attention" }),
      );
      await writeTicket(
        tempDir,
        makeTicket({ id: "gh-3", phase: "merge", status: "waiting" }),
      );

      const writeLastWorked = spy((_ids: string[]) => Promise.resolve());
      await advanceTickets(
        {
          github: { repos: [] },
          state: { dir: tempDir },
          tick: { concurrency: 3 },
          codebase: { roots: [] },
          packages: { enabled: [] },
        },
        {
          runMigrations: (_, tickets) => Promise.resolve(tickets),
          readLastWorked: () => Promise.resolve([]),
          writeLastWorked,
        },
      );

      assertSpyCall(writeLastWorked, 0, { args: [[]] });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);
