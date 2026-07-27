import { assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import {
  advancePhase,
  resolvePhaseModel,
  selectCandidates,
  TickService,
} from "./tick.ts";
import type { TickDeps, TickServiceDeps } from "./tick.ts";
import type { Lock } from "./lock.ts";
import type { Config, TicketState } from "./state/types.ts";
import type { Provider, WorkItem } from "./providers/types.ts";

type SpawnOpts = Parameters<TickDeps["spawn"]>[0];

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1",
    provider: "github",
    title: "T",
    url: "u",
    phase: "intake",
    status: "new",
    approvals: [],
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
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedPhase, "intake");
});

Deno.test("advancePhase: running phase with dead PID sets waiting", async () => {
  const ticket = makeTicket({ phase: "intake", status: "running" });
  let written = { phase: "", status: "" };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = { phase: t.phase, status: t.status };
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "intake");
  assertEquals(written.status, "waiting");
});

Deno.test("advancePhase: implementation running with dead PID transitions to implementation/waiting", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "running",
  });
  let written = { phase: "", status: "" };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = { phase: t.phase, status: t.status };
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "implementation");
  assertEquals(written.status, "waiting");
});

Deno.test("advancePhase: running phase with live PID does nothing", async () => {
  const ticket = makeTicket({ phase: "intake", status: "running" });
  const writeTicketSpy = spy((_dir: string, _t: TicketState) =>
    Promise.resolve()
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => true,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCalls(writeTicketSpy, 0);
});

Deno.test("advancePhase: waiting + approved advances to next phase", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
  });
  let spawnedPhase = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedPhase = opts.phase;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedPhase, "enrichment");
});

Deno.test("advancePhase: waiting + not approved does nothing", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approvals: [],
  });
  const spawnSpy = spy(() => Promise.resolve());
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCalls(spawnSpy, 0);
});

Deno.test("advancePhase: implementation/waiting + approved advances to merge/waiting", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "waiting",
    approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
  });
  let written = { phase: "", status: "" };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = { phase: t.phase, status: t.status };
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "merge");
  assertEquals(written.status, "waiting");
});

Deno.test("advancePhase: implementation phase receives ticket worktrees", async () => {
  const ticket = makeTicket({
    phase: "plan",
    status: "waiting",
    approvals: [{ timestamp: "t", actor: "human", phase: "plan" }],
    worktrees: {
      "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" },
    },
  });
  let spawnedWorktrees: Record<string, unknown> = {};
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedWorktrees = opts.worktrees;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
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
    approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
    worktrees: {
      "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" },
    },
  });
  let spawnedWorktrees: Record<string, unknown> = {};
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedWorktrees = opts.worktrees;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedWorktrees, {});
});

Deno.test("advancePhase: new ticket spawn receives empty worktrees", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "new",
    worktrees: {
      "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" },
    },
  });
  let spawnedWorktrees: Record<string, unknown> = {};
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedWorktrees = opts.worktrees;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedWorktrees, {});
});

Deno.test("advancePhase: implementation phase with empty worktrees transitions to needs-attention", async () => {
  const ticket = makeTicket({
    phase: "plan",
    status: "waiting",
    approvals: [{ timestamp: "t", actor: "human", phase: "plan" }],
    worktrees: {},
  });
  let written = { phase: "", status: "" };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = { phase: t.phase, status: t.status };
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "implementation");
  assertEquals(written.status, "needs-attention");
});

Deno.test("advancePhase: new ticket logs status-only transition", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(appendLogSpy, 0);
  assertSpyCalls(appendLogSpy, 1);
  assertEquals(appendLogSpy.calls[0].args[2], {
    event: "status-transition",
    phase: "intake",
    from: "new",
    to: "running",
  });
});

Deno.test("advancePhase: dead PID on non-impl phase logs status-only transition", async () => {
  const ticket = makeTicket({ phase: "enrichment", status: "running" });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(appendLogSpy, 0);
  assertEquals(appendLogSpy.calls[0].args[2], {
    event: "status-transition",
    phase: "enrichment",
    from: "running",
    to: "waiting",
  });
});

Deno.test("advancePhase: dead PID on implementation logs status-transition to waiting", async () => {
  const ticket = makeTicket({ phase: "implementation", status: "running" });
  const logEntries: object[] = [];
  const appendLogSpy = spy(
    (_dir: string, _id: string, entry: object) => {
      logEntries.push(entry);
      return Promise.resolve();
    },
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCalls(appendLogSpy, 1);
  assertEquals(logEntries[0], {
    event: "status-transition",
    phase: "implementation",
    from: "running",
    to: "waiting",
  });
});

Deno.test("advancePhase: live PID does not log", async () => {
  const ticket = makeTicket({ phase: "intake", status: "running" });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => true,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCalls(appendLogSpy, 0);
});

Deno.test("advancePhase: implementation/waiting approved logs implementation → merge", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "waiting",
    approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
  });
  const logEntries: object[] = [];
  const appendLogSpy = spy(
    (_dir: string, _id: string, entry: object) => {
      logEntries.push(entry);
      return Promise.resolve();
    },
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCalls(appendLogSpy, 1);
  assertEquals(logEntries[0], {
    event: "phase-transition",
    from: "implementation",
    to: "merge",
  });
});

Deno.test(
  "advancePhase: implementation/waiting+approved with unmerged PRs calls markPRsReady with those URLs",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
      prs: [
        {
          url: "https://github.com/o/r/pull/1",
          title: "T1",
          dependsOn: [],
          merged: false,
        },
        {
          url: "https://github.com/o/r/pull/2",
          title: "T2",
          dependsOn: [],
          merged: true,
        },
      ],
    });
    const markPRsReadySpy = spy((_urls: string[]) => Promise.resolve());
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: markPRsReadySpy,
    });
    assertSpyCall(markPRsReadySpy, 0, {
      args: [["https://github.com/o/r/pull/1"]],
    });
  },
);

Deno.test(
  "advancePhase: implementation/waiting+approved with no prs field does not call markPRsReady",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
    });
    const markPRsReadySpy = spy((_urls: string[]) => Promise.resolve());
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: markPRsReadySpy,
    });
    assertSpyCalls(markPRsReadySpy, 0);
  },
);

Deno.test(
  "advancePhase: implementation/waiting+approved with empty prs array does not call markPRsReady",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
      prs: [],
    });
    const markPRsReadySpy = spy((_urls: string[]) => Promise.resolve());
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: markPRsReadySpy,
    });
    assertSpyCalls(markPRsReadySpy, 0);
  },
);

Deno.test(
  "advancePhase: implementation/waiting+approved with all PRs merged does not call markPRsReady",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
      prs: [
        {
          url: "https://github.com/o/r/pull/1",
          title: "T1",
          dependsOn: [],
          merged: true,
        },
      ],
    });
    const markPRsReadySpy = spy((_urls: string[]) => Promise.resolve());
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: markPRsReadySpy,
    });
    assertSpyCalls(markPRsReadySpy, 0);
  },
);

Deno.test(
  "advancePhase: implementation/waiting+approved markPRsReady failure logs error and still transitions to merge/waiting",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
      prs: [
        {
          url: "https://github.com/o/r/pull/1",
          title: "T1",
          dependsOn: [],
          merged: false,
        },
      ],
    });
    const writtenTickets: TicketState[] = [];
    const writeTicketSpy = spy((_dir: string, t: TicketState) => {
      writtenTickets.push(t);
      return Promise.resolve();
    });
    const logEntries2: object[] = [];
    const appendLogSpy2 = spy(
      (_dir: string, _id: string, entry: object) => {
        logEntries2.push(entry);
        return Promise.resolve();
      },
    );
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: writeTicketSpy,
      writePhaseOutput: () => Promise.resolve(),
      appendLog: appendLogSpy2,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.reject(new Error("API error")),
    });
    assertSpyCall(writeTicketSpy, 0);
    assertEquals(writtenTickets[0].phase, "merge");
    assertEquals(writtenTickets[0].status, "waiting");
    assertEquals(
      logEntries2.some(
        (e) =>
          (e as Record<string, unknown>).event === "error" &&
          (e as Record<string, unknown>).context === "markPRsReady",
      ),
      true,
    );
  },
);

Deno.test("implementation.md contains explicit draft PR instruction", async () => {
  const content = await Deno.readTextFile(
    new URL("./phases/prompts/implementation.md", import.meta.url).pathname,
  );
  assertEquals(
    content.includes("pull requests in draft mode"),
    true,
  );
});

Deno.test("advancePhase: approved waiting phase logs transition to next phase", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
  });
  const logEntries: object[] = [];
  const appendLogSpy = spy(
    (_dir: string, _id: string, entry: object) => {
      logEntries.push(entry);
      return Promise.resolve();
    },
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCalls(appendLogSpy, 1);
  assertEquals(logEntries[0], {
    event: "phase-transition",
    from: "intake",
    to: "enrichment",
  });
});

Deno.test("advancePhase: no worktrees logs plan → needs-attention", async () => {
  const ticket = makeTicket({
    phase: "plan",
    status: "waiting",
    approvals: [{ timestamp: "t", actor: "human", phase: "plan" }],
    worktrees: {},
  });
  const logEntries: object[] = [];
  const appendLogSpy = spy(
    (_dir: string, _id: string, entry: object) => {
      logEntries.push(entry);
      return Promise.resolve();
    },
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCalls(appendLogSpy, 1);
  assertEquals(logEntries[0], {
    event: "phase-transition",
    from: "plan",
    to: "needs-attention",
  });
});

Deno.test("advancePhase: log entry does not include ts (appended by appendTicketLog)", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  const logEntries: object[] = [];
  const appendLogSpy = spy(
    (_dir: string, _id: string, entry: object) => {
      logEntries.push(entry);
      return Promise.resolve();
    },
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCalls(appendLogSpy, 1);
  assertEquals("ts" in logEntries[0], false);
});

Deno.test("advancePhase: revising status spawns plan with timestamped outputFile", async () => {
  const ticket = makeTicket({ phase: "plan", status: "revising" });
  let spawnedOutputFile = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(/^\d{8}T\d{6}-plan\.md$/.test(spawnedOutputFile), true);
});

Deno.test("advancePhase: revising status transitions to running", async () => {
  const ticket = makeTicket({
    phase: "plan",
    status: "revising",
  });
  const writtenTickets: TicketState[] = [];
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    writtenTickets.push(t);
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: writeTicketSpy,
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(writtenTickets[0].status, "running");
});

Deno.test("advancePhase: revising status logs status-transition from revising to running", async () => {
  const ticket = makeTicket({ phase: "plan", status: "revising" });
  const logEntries: object[] = [];
  const appendLogSpy = spy(
    (_dir: string, _id: string, entry: object) => {
      logEntries.push(entry);
      return Promise.resolve();
    },
  );
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: appendLogSpy,
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCalls(appendLogSpy, 1);
  assertEquals(logEntries[0], {
    event: "status-transition",
    phase: "plan",
    from: "revising",
    to: "running",
  });
});

Deno.test("advancePhase: revising outputFile uses YYYYMMDDTHHMMSS prefix format", async () => {
  const ticket = makeTicket({ phase: "plan", status: "revising" });
  let spawnedOutputFile: string | undefined;
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(
    /^\d{8}T\d{6}-plan\.md$/.test(spawnedOutputFile ?? ""),
    true,
  );
});

Deno.test("advancePhase: new status spawn receives timestamp-prefixed intake output filename", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  let spawnedOutputFile = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(/^\d{8}T\d{6}-intake\.md$/.test(spawnedOutputFile), true);
});

Deno.test("advancePhase: waiting+approved spawn receives timestamp-prefixed next-phase output filename", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
  });
  let spawnedOutputFile = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(
    /^\d{8}T\d{6}-enrichment\.md$/.test(spawnedOutputFile ?? ""),
    true,
  );
});

// ── TickService ────────────────────────────────────────────────────────────────

function makeFakeTickDeps(): TickDeps {
  return {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-sonnet-4-6", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  };
}

function makeFakeServiceDeps(
  overrides: Partial<TickServiceDeps> = {},
): TickServiceDeps {
  return {
    stateDir: "/state",
    concurrency: 1,
    packageSources: [],
    installPackages: () => Promise.resolve([]),
    providers: [],
    tickActions: [],
    tickDeps: makeFakeTickDeps(),
    runMigrations: (_dir, tickets) => Promise.resolve(tickets),
    readLastWorked: () => Promise.resolve([]),
    writeLastWorked: () => Promise.resolve(),
    listTickets: () => Promise.resolve([]),
    readTicket: (_id) => Promise.resolve(makeTicket()),
    writeTicket: () => Promise.resolve(),
    commitState: () => Promise.resolve(),
    lock: { withLock: (fn) => fn() },
    ...overrides,
  };
}

Deno.test("TickService: lock.withLock called once per run()", async () => {
  let calls = 0;
  const lock: Lock = {
    withLock: async (fn) => {
      calls++;
      await fn();
    },
  };
  const deps = makeFakeServiceDeps({ lock });
  await new TickService(deps).run();
  assertEquals(calls, 1);
});

Deno.test(
  "TickService: workflow does not run if lock.withLock does not call fn",
  async () => {
    const listTicketsSpy = spy(() => Promise.resolve([]));
    const lock: Lock = { withLock: (_fn) => Promise.resolve() };
    const deps = makeFakeServiceDeps({ lock, listTickets: listTicketsSpy });
    await new TickService(deps).run();
    assertSpyCalls(listTicketsSpy, 0);
  },
);

Deno.test(
  "TickService: installPackages called with packageSources before listTickets",
  async () => {
    const sequence: string[] = [];
    const deps = makeFakeServiceDeps({
      packageSources: ["npm:foo"],
      installPackages: spy(() => {
        sequence.push("install");
        return Promise.resolve([]);
      }),
      listTickets: spy(() => {
        sequence.push("list");
        return Promise.resolve([]);
      }),
    });
    await new TickService(deps).run();
    assertEquals(sequence[0], "install");
    assertEquals(sequence[1], "list");
  },
);

Deno.test(
  "TickService: providers.fetchNew called with existingIds set",
  async () => {
    let capturedIds: Set<string> | null = null;
    const provider: Provider = {
      fetchNew: (ids) => {
        capturedIds = ids;
        return Promise.resolve([]);
      },
      close: () => Promise.resolve(),
    };
    const deps = makeFakeServiceDeps({
      providers: [provider],
      listTickets: () => Promise.resolve(["gh-1"]),
    });
    await new TickService(deps).run();
    assertEquals(capturedIds, new Set(["gh-1"]));
  },
);

Deno.test(
  "TickService: new work items written as tickets with intake/new",
  async () => {
    const item: WorkItem = {
      id: "gh-2",
      provider: "github",
      title: "Title",
      url: "https://github.com/t/r/issues/2",
      description: "body",
    };
    const provider: Provider = {
      fetchNew: () => Promise.resolve([item]),
      close: () => Promise.resolve(),
    };
    const writtenTickets: TicketState[] = [];
    const deps = makeFakeServiceDeps({
      providers: [provider],
      listTickets: () => Promise.resolve([]),
      writeTicket: spy((t: TicketState) => {
        writtenTickets.push(t);
        return Promise.resolve();
      }),
    });
    await new TickService(deps).run();
    assertEquals(writtenTickets.length, 1);
    assertEquals(writtenTickets[0].id, "gh-2");
    assertEquals(writtenTickets[0].phase, "intake");
    assertEquals(writtenTickets[0].status, "new");
    assertEquals(writtenTickets[0].approvals, []);
    assertEquals(writtenTickets[0].body, "body");
  },
);

Deno.test(
  "TickService: runMigrations called before tick actions",
  async () => {
    const sequence: string[] = [];
    const ticket = makeTicket({ id: "gh-1", phase: "intake", status: "new" });
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      runMigrations: spy((_dir, tickets) => {
        sequence.push("migrate");
        return Promise.resolve(tickets);
      }),
      tickActions: [{
        applies: (_t) => {
          sequence.push("action");
          return false;
        },
        run: () => Promise.resolve(null),
      }],
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertEquals(
      sequence.indexOf("migrate") < sequence.indexOf("action"),
      true,
    );
  },
);

Deno.test(
  "TickService: tickAction.applies and .run called for matching ticket",
  async () => {
    const ticket = makeTicket({ id: "gh-1", phase: "intake", status: "new" });
    const runSpy = spy(
      (_t: TicketState, _sd: string) =>
        Promise.resolve<TicketState | null>(null),
    );
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      tickActions: [{ applies: () => true, run: runSpy }],
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertSpyCalls(runSpy, 1);
  },
);

Deno.test(
  "TickService: writeLastWorked called with selected candidate IDs",
  async () => {
    const t1 = makeTicket({
      id: "gh-1",
      phase: "intake",
      status: "waiting",
    });
    const t2 = makeTicket({
      id: "gh-2",
      phase: "intake",
      status: "waiting",
    });
    const store: Record<string, TicketState> = { "gh-1": t1, "gh-2": t2 };
    const writeLastWorkedSpy = spy((_ids: string[]) => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1", "gh-2"]),
      readTicket: (id) => Promise.resolve(store[id]),
      writeLastWorked: writeLastWorkedSpy,
      concurrency: 1,
    });
    await new TickService(deps).run();
    assertSpyCall(writeLastWorkedSpy, 0, { args: [["gh-1"]] });
  },
);

Deno.test(
  "TickService: readLastWorked shifts round-robin start position",
  async () => {
    const t1 = makeTicket({
      id: "gh-1",
      phase: "intake",
      status: "waiting",
    });
    const t2 = makeTicket({
      id: "gh-2",
      phase: "intake",
      status: "waiting",
    });
    const t3 = makeTicket({
      id: "gh-3",
      phase: "intake",
      status: "waiting",
    });
    const store: Record<string, TicketState> = {
      "gh-1": t1,
      "gh-2": t2,
      "gh-3": t3,
    };
    const writeLastWorkedSpy = spy((_ids: string[]) => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1", "gh-2", "gh-3"]),
      readTicket: (id) => Promise.resolve(store[id]),
      readLastWorked: () => Promise.resolve(["gh-1"]),
      writeLastWorked: writeLastWorkedSpy,
      concurrency: 1,
    });
    await new TickService(deps).run();
    assertSpyCall(writeLastWorkedSpy, 0, { args: [["gh-2"]] });
  },
);

Deno.test(
  "TickService: running tickets excluded from writeLastWorked",
  async () => {
    const running = makeTicket({
      id: "gh-1",
      phase: "intake",
      status: "running",
    });
    const waiting = makeTicket({
      id: "gh-2",
      phase: "intake",
      status: "waiting",
    });
    const store: Record<string, TicketState> = {
      "gh-1": running,
      "gh-2": waiting,
    };
    const writeLastWorkedSpy = spy((_ids: string[]) => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1", "gh-2"]),
      readTicket: (id) => Promise.resolve(store[id]),
      tickDeps: {
        spawn: () => Promise.resolve(),
        isProcessAlive: (id) => id === "gh-1",
        writeTicket: () => Promise.resolve(),
        writePhaseOutput: () => Promise.resolve(),
        appendLog: () => Promise.resolve(),
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        selfReview: () => Promise.resolve({ approved: false, reason: null }),
        markPRsReady: () => Promise.resolve(),
      },
      writeLastWorked: writeLastWorkedSpy,
      concurrency: 2,
    });
    await new TickService(deps).run();
    assertSpyCall(writeLastWorkedSpy, 0, { args: [["gh-2"]] });
  },
);

Deno.test(
  "TickService: writeLastWorked called with empty array when no candidates",
  async () => {
    const running = makeTicket({
      id: "gh-1",
      phase: "intake",
      status: "running",
    });
    const store: Record<string, TicketState> = { "gh-1": running };
    const writeLastWorkedSpy = spy((_ids: string[]) => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: (id) => Promise.resolve(store[id]),
      writeLastWorked: writeLastWorkedSpy,
      concurrency: 2,
    });
    await new TickService(deps).run();
    assertSpyCall(writeLastWorkedSpy, 0, { args: [[]] });
  },
);

Deno.test(
  "TickService: skipped-status tickets not included in candidates or writeLastWorked",
  async () => {
    const done = makeTicket({ id: "gh-1", phase: "merge", status: "done" });
    const needsAttention = makeTicket({
      id: "gh-2",
      phase: "intake",
      status: "needs-attention",
    });
    const mergeWaiting = makeTicket({
      id: "gh-3",
      phase: "merge",
      status: "waiting",
    });
    const store: Record<string, TicketState> = {
      "gh-1": done,
      "gh-2": needsAttention,
      "gh-3": mergeWaiting,
    };
    const writeLastWorkedSpy = spy((_ids: string[]) => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1", "gh-2", "gh-3"]),
      readTicket: (id) => Promise.resolve(store[id]),
      writeLastWorked: writeLastWorkedSpy,
      concurrency: 3,
    });
    await new TickService(deps).run();
    assertSpyCall(writeLastWorkedSpy, 0, { args: [[]] });
  },
);

Deno.test(
  "TickService: wont-do tickets not included in candidates or writeLastWorked",
  async () => {
    const wontDo = makeTicket({
      id: "gh-wont-do",
      phase: "wont-do",
      status: "done",
    });
    const store: Record<string, TicketState> = { "gh-wont-do": wontDo };
    const writeLastWorkedSpy = spy((_ids: string[]) => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-wont-do"]),
      readTicket: (id) => Promise.resolve(store[id]),
      writeLastWorked: writeLastWorkedSpy,
      concurrency: 3,
    });
    await new TickService(deps).run();
    assertSpyCall(writeLastWorkedSpy, 0, { args: [[]] });
  },
);

Deno.test(
  "TickService: commitState called after writeLastWorked",
  async () => {
    const sequence: string[] = [];
    const deps = makeFakeServiceDeps({
      writeLastWorked: spy(() => {
        sequence.push("writeLastWorked");
        return Promise.resolve();
      }),
      commitState: spy(() => {
        sequence.push("commitState");
        return Promise.resolve();
      }),
    });
    await new TickService(deps).run();
    assertEquals(
      sequence.indexOf("writeLastWorked") < sequence.indexOf("commitState"),
      true,
    );
  },
);

Deno.test("TickService: exit(1) called when workflow throws", async () => {
  const exitSpy = spy((_code: number) => {});
  const deps = makeFakeServiceDeps({
    listTickets: () => Promise.reject(new Error("workflow error")),
    exit: exitSpy,
  });
  await new TickService(deps).run();
  assertSpyCall(exitSpy, 0, { args: [1] });
});

Deno.test(
  "TickService: writes tick-failed entry via injected appendTickLog when workflow throws",
  async () => {
    const captured: object[] = [];
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.reject(new Error("workflow error")),
      appendTickLog: (entry) => {
        captured.push(entry);
        return Promise.resolve();
      },
      exit: () => {},
    });
    await new TickService(deps).run();
    assertEquals(captured.length, 1);
    const entry = captured[0] as Record<string, unknown>;
    assertEquals(entry.event, "tick-failed");
    assertEquals(entry.error, "workflow error");
    assertEquals(typeof entry.ts, "string");
  },
);

// ── selectCandidates ──────────────────────────────────────────────────────────

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

// ── resolvePhaseModel ────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    github: { repos: [] },
    state: { dir: "" },
    tick: { concurrency: 1 },
    codebase: { roots: [] },
    packages: { enabled: [] },
    pi: { provider: "anthropic" },
    agent: { type: "pi" },
    ...overrides,
  };
}

Deno.test("resolvePhaseModel: returns hardcoded defaults when no overrides", () => {
  const config = makeConfig();
  const ticket = makeTicket();
  assertEquals(resolvePhaseModel(config, "intake", ticket), {
    model: "claude-haiku-4-5",
    thinking: "off",
  });
  assertEquals(resolvePhaseModel(config, "spec", ticket), {
    model: "claude-sonnet-4-6",
    thinking: "high",
  });
  assertEquals(resolvePhaseModel(config, "conflict-resolution", ticket), {
    model: "claude-opus-4-7",
    thinking: "high",
  });
});

Deno.test("resolvePhaseModel: config default overrides hardcoded for conflict-resolution", () => {
  const config = makeConfig({
    phases: {
      defaults: { "conflict-resolution": { model: "claude-sonnet-4-6" } },
    },
  });
  const ticket = makeTicket();
  assertEquals(resolvePhaseModel(config, "conflict-resolution", ticket), {
    model: "claude-sonnet-4-6",
    thinking: "high",
  });
});

Deno.test("resolvePhaseModel: ticket phases override config for conflict-resolution", () => {
  const config = makeConfig({
    phases: {
      defaults: { "conflict-resolution": { model: "claude-sonnet-4-6" } },
    },
  });
  const ticket = makeTicket({
    phases: {
      "conflict-resolution": { model: "claude-haiku-4-5", thinking: "off" },
    },
  });
  assertEquals(resolvePhaseModel(config, "conflict-resolution", ticket), {
    model: "claude-haiku-4-5",
    thinking: "off",
  });
});

Deno.test("resolvePhaseModel: config default overrides hardcoded", () => {
  const config = makeConfig({
    phases: { defaults: { intake: { model: "claude-opus-4-5" } } },
  });
  const ticket = makeTicket();
  assertEquals(resolvePhaseModel(config, "intake", ticket), {
    model: "claude-opus-4-5",
    thinking: "off",
  });
});

Deno.test("resolvePhaseModel: config default sets thinking only", () => {
  const config = makeConfig({
    phases: { defaults: { intake: { thinking: "high" } } },
  });
  const ticket = makeTicket();
  assertEquals(resolvePhaseModel(config, "intake", ticket), {
    model: "claude-haiku-4-5",
    thinking: "high",
  });
});

Deno.test("resolvePhaseModel: ticket phases override config for implementation", () => {
  const config = makeConfig({
    phases: { defaults: { implementation: { model: "claude-haiku-4-5" } } },
  });
  const ticket = makeTicket({
    phases: { implementation: { model: "claude-opus-4-7", thinking: "max" } },
  });
  assertEquals(resolvePhaseModel(config, "implementation", ticket), {
    model: "claude-opus-4-7",
    thinking: "max",
  });
});

Deno.test("resolvePhaseModel: ticket phases override config for any phase", () => {
  const config = makeConfig();
  const ticket = makeTicket({
    phases: { intake: { model: "claude-opus-4-7", thinking: "max" } },
  });
  assertEquals(resolvePhaseModel(config, "intake", ticket), {
    model: "claude-opus-4-7",
    thinking: "max",
  });
});

Deno.test("resolvePhaseModel: ticket phases model-only, thinking from hardcoded", () => {
  const config = makeConfig();
  const ticket = makeTicket({
    phases: { intake: { model: "claude-opus-4-7" } },
  });
  assertEquals(resolvePhaseModel(config, "intake", ticket), {
    model: "claude-opus-4-7",
    thinking: "off",
  });
});

Deno.test("advancePhase: spawn receives model and thinking from resolveModelConfig", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  let spawnedModel = "";
  let spawnedThinking = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedModel = opts.model;
    spawnedThinking = opts.thinking;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: () => ({ model: "claude-opus-4-7", thinking: "max" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedModel, "claude-opus-4-7");
  assertEquals(spawnedThinking, "max");
});

Deno.test("advancePhase: resolveModelConfig called with the phase being spawned", async () => {
  const ticket = makeTicket({
    phase: "intake",
    status: "waiting",
    approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
  });
  let resolvedPhase = "";
  await advancePhase(ticket, "/state", {
    spawn: () => Promise.resolve(),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    writePhaseOutput: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    resolveModelConfig: (phase, _t) => {
      resolvedPhase = phase;
      return { model: "m", thinking: "off" };
    },
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertEquals(resolvedPhase, "enrichment");
});

Deno.test("advancePhase: implementation/revising spawns with ticket.worktrees", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "revising",
    worktrees: {
      "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-99" },
    },
  });
  let spawnedWorktrees: Record<string, unknown> = {};
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedWorktrees = opts.worktrees;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: async () => {},
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedWorktrees, {
    "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-99" },
  });
});

Deno.test("advancePhase: non-implementation revising uses empty worktrees", async () => {
  const ticket = makeTicket({
    phase: "plan",
    status: "revising",
    worktrees: {
      "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-99" },
    },
  });
  let spawnedWorktrees: Record<string, unknown> = {};
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedWorktrees = opts.worktrees;
    return Promise.resolve();
  });
  await advancePhase(ticket, "/state", {
    spawn: spawnSpy,
    isProcessAlive: () => false,
    writeTicket: async () => {},
    writePhaseOutput: async () => {},
    appendLog: async () => {},
    resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    selfReview: () => Promise.resolve({ approved: false, reason: null }),
    markPRsReady: () => Promise.resolve(),
  });
  assertSpyCall(spawnSpy, 0);
  assertEquals(spawnedWorktrees, {});
});

Deno.test(
  "advancePhase: running ticket with dead PID and selfReview true sets approved and logs self-approved",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writtenTickets: TicketState[] = [];
    const writeTicketSpy = spy((_dir: string, t: TicketState) => {
      writtenTickets.push(t);
      return Promise.resolve();
    });
    const logEntries: object[] = [];
    const appendLogSpy = spy(
      (_dir: string, _id: string, entry: object) => {
        logEntries.push(entry);
        return Promise.resolve();
      },
    );
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: writeTicketSpy,
      writePhaseOutput: () => Promise.resolve(),
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: true, reason: null }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCalls(writeTicketSpy, 2);
    assertEquals(writtenTickets[0].status, "waiting");
    assertEquals(writtenTickets[0].approvals, []);
    assertEquals(writtenTickets[1].status, "waiting");
    assertEquals(writtenTickets[1].approvals.length, 1);
    assertEquals(writtenTickets[1].approvals[0].actor, "agent");
    assertEquals(writtenTickets[1].approvals[0].phase, "intake");
    assertEquals(logEntries.length, 2);
    assertEquals(logEntries[0], {
      event: "status-transition",
      phase: "intake",
      from: "running",
      to: "waiting",
    });
    assertEquals(logEntries[1], { event: "self-approved", phase: "intake" });
  },
);

Deno.test(
  "advancePhase: running ticket with dead PID and selfReview false leaves approved false",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writtenTickets: TicketState[] = [];
    const writeTicketSpy = spy((_dir: string, t: TicketState) => {
      writtenTickets.push(t);
      return Promise.resolve();
    });
    const logEntries: object[] = [];
    const appendLogSpy = spy(
      (_dir: string, _id: string, entry: object) => {
        logEntries.push(entry);
        return Promise.resolve();
      },
    );
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: writeTicketSpy,
      writePhaseOutput: () => Promise.resolve(),
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCalls(writeTicketSpy, 1);
    assertEquals(writtenTickets[0].approvals, []);
    assertEquals(logEntries.length, 1);
    assertEquals(logEntries[0], {
      event: "status-transition",
      phase: "intake",
      from: "running",
      to: "waiting",
    });
  },
);

Deno.test(
  "advancePhase: selfReview throwing is treated as false",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writeTicketSpy = spy((_dir: string, _t: TicketState) =>
      Promise.resolve()
    );
    const appendLogSpy = spy(
      (_dir: string, _id: string, _entry: object) => Promise.resolve(),
    );
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: writeTicketSpy,
      writePhaseOutput: () => Promise.resolve(),
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.reject(new Error("review exploded")),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCalls(writeTicketSpy, 1);
    assertSpyCalls(appendLogSpy, 1);
  },
);

Deno.test(
  "advancePhase: selfReview returning false leaves ticket waiting with no approvals",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writtenTickets: TicketState[] = [];
    const writeTicketSpy = spy((_dir: string, t: TicketState) => {
      writtenTickets.push(t);
      return Promise.resolve();
    });
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: writeTicketSpy,
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCalls(writeTicketSpy, 1);
    assertEquals(writtenTickets[0].approvals, []);
  },
);

Deno.test(
  "advancePhase: selfReview returning reason writes self-review output file",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writePhaseOutputCalls: Array<[string, string, string, string]> = [];
    const writePhaseOutputSpy = spy(
      (stateDir: string, id: string, file: string, content: string) => {
        writePhaseOutputCalls.push([stateDir, id, file, content]);
        return Promise.resolve();
      },
    );
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: writePhaseOutputSpy,
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () =>
        Promise.resolve({
          approved: false,
          reason: "REJECT\nCriterion 1 violated.",
        }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCalls(writePhaseOutputSpy, 1);
    assertEquals(writePhaseOutputCalls[0][0], "/state");
    assertEquals(writePhaseOutputCalls[0][1], "gh-1");
    assertEquals(
      /^\d{8}T\d{6}-intake-self-review\.md$/.test(
        writePhaseOutputCalls[0][2],
      ),
      true,
    );
    assertEquals(writePhaseOutputCalls[0][3], "REJECT\nCriterion 1 violated.");
  },
);

Deno.test(
  "advancePhase: selfReview returning null reason does not write output file",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writePhaseOutputSpy = spy(() => Promise.resolve());
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: writePhaseOutputSpy,
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCalls(writePhaseOutputSpy, 0);
  },
);

Deno.test(
  "advancePhase: selfReview is called with the ticket phase and ticketDir",
  async () => {
    const ticket = makeTicket({
      id: "github/jackjennings/lazyboy/104",
      phase: "intake",
      status: "running",
    });
    let capturedPhase = "";
    let capturedTicketDir = "";
    const selfReviewSpy = spy((phase: string, ticketDir: string) => {
      capturedPhase = phase;
      capturedTicketDir = ticketDir;
      return Promise.resolve({ approved: false, reason: null });
    });
    await advancePhase(ticket, "/state", {
      spawn: () => Promise.resolve(),
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: selfReviewSpy,
      markPRsReady: () => Promise.resolve(),
    });
    assertEquals(capturedPhase, "intake");
    assertEquals(
      capturedTicketDir,
      "/state/github/jackjennings/lazyboy/104",
    );
  },
);

Deno.test(
  "advancePhase: github implementation phase advance appends provider supplement",
  async () => {
    const ticket = makeTicket({
      phase: "plan",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "plan" }],
      provider: "github",
      worktrees: {
        "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" },
      },
    });
    let spawnedPrompt = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPrompt = opts.prompt;
      return Promise.resolve();
    });
    await advancePhase(ticket, "/state", {
      spawn: spawnSpy,
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({
        model: "claude-sonnet-4-6",
        thinking: "off",
      }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCall(spawnSpy, 0);
    const supplement = await Deno.readTextFile(
      new URL(
        "./phases/prompts/github-implementation.md",
        import.meta.url,
      ).pathname,
    );
    assertEquals(spawnedPrompt.includes(supplement.trim()), true);
    assertEquals(spawnedPrompt.includes("\n\n"), true);
  },
);

Deno.test(
  "advancePhase: github implementation revising appends provider supplement",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "revising",
      provider: "github",
      worktrees: {
        "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-99" },
      },
    });
    let spawnedPrompt = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPrompt = opts.prompt;
      return Promise.resolve();
    });
    await advancePhase(ticket, "/state", {
      spawn: spawnSpy,
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCall(spawnSpy, 0);
    const supplement = await Deno.readTextFile(
      new URL(
        "./phases/prompts/github-implementation.md",
        import.meta.url,
      ).pathname,
    );
    assertEquals(spawnedPrompt.includes(supplement.trim()), true);
    assertEquals(spawnedPrompt.includes("gh pr create"), false);
  },
);

Deno.test(
  "advancePhase: non-github implementation phase advance uses base prompt only",
  async () => {
    const ticket = makeTicket({
      phase: "plan",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "plan" }],
      provider: "jira",
      worktrees: {
        "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" },
      },
    });
    let spawnedPrompt = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPrompt = opts.prompt;
      return Promise.resolve();
    });
    await advancePhase(ticket, "/state", {
      spawn: spawnSpy,
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({
        model: "claude-sonnet-4-6",
        thinking: "off",
      }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCall(spawnSpy, 0);
    const basePrompt = await Deno.readTextFile(
      new URL(
        "./phases/prompts/implementation.md",
        import.meta.url,
      ).pathname,
    );
    assertEquals(spawnedPrompt, basePrompt);
  },
);

Deno.test(
  "advancePhase: new ticket intake prompt is unchanged when no provider supplement exists",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "new",
      provider: "github",
    });
    let spawnedPrompt = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPrompt = opts.prompt;
      return Promise.resolve();
    });
    await advancePhase(ticket, "/state", {
      spawn: spawnSpy,
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({
        model: "claude-sonnet-4-6",
        thinking: "off",
      }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCall(spawnSpy, 0);
    const basePrompt = await Deno.readTextFile(
      new URL("./phases/prompts/intake.md", import.meta.url).pathname,
    );
    assertEquals(spawnedPrompt, basePrompt);
  },
);

Deno.test(
  "advancePhase: new ticket intake prompt appends repo corpus text when present",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "new",
      provider: "jira",
    });
    let spawnedPrompt = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPrompt = opts.prompt;
      return Promise.resolve();
    });
    await advancePhase(ticket, "/state", {
      spawn: spawnSpy,
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({
        model: "claude-sonnet-4-6",
        thinking: "off",
      }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.resolve(),
      buildRepoCorpusText: () =>
        Promise.resolve(
          "## Available Repositories\n\n- myorg/frontend (checked out at /code/myorg/frontend)\n",
        ),
    });
    assertSpyCall(spawnSpy, 0);
    const basePrompt = await Deno.readTextFile(
      new URL("./phases/prompts/intake.md", import.meta.url).pathname,
    );
    assertEquals(
      spawnedPrompt,
      basePrompt +
        "\n\n## Available Repositories\n\n" +
        "- myorg/frontend (checked out at /code/myorg/frontend)\n",
    );
  },
);

Deno.test(
  "advancePhase: new ticket intake prompt has no trailing corpus block when buildRepoCorpusText is absent",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "new",
      provider: "jira",
    });
    let spawnedPrompt = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPrompt = opts.prompt;
      return Promise.resolve();
    });
    await advancePhase(ticket, "/state", {
      spawn: spawnSpy,
      isProcessAlive: () => false,
      writeTicket: () => Promise.resolve(),
      writePhaseOutput: () => Promise.resolve(),
      appendLog: () => Promise.resolve(),
      resolveModelConfig: () => ({
        model: "claude-sonnet-4-6",
        thinking: "off",
      }),
      selfReview: () => Promise.resolve({ approved: false, reason: null }),
      markPRsReady: () => Promise.resolve(),
    });
    assertSpyCall(spawnSpy, 0);
    const basePrompt = await Deno.readTextFile(
      new URL("./phases/prompts/intake.md", import.meta.url).pathname,
    );
    assertEquals(spawnedPrompt, basePrompt);
  },
);

Deno.test(
  "TickService: notify called for needs-attention ticket",
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "implementation",
      status: "needs-attention",
    });
    const notifySpy = spy((_t: TicketState) => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      notify: notifySpy,
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertSpyCalls(notifySpy, 1);
  },
);

Deno.test(
  "TickService: notify called with the needs-attention ticket",
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "implementation",
      status: "needs-attention",
    });
    const capturedTickets: TicketState[] = [];
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      notify: (t) => {
        capturedTickets.push(t);
        return Promise.resolve();
      },
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertEquals(capturedTickets.length, 1);
    assertEquals(capturedTickets[0].id, "gh-1");
    assertEquals(capturedTickets[0].status, "needs-attention");
  },
);

Deno.test(
  "TickService: notify not called for non-needs-attention ticket",
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "intake",
      status: "waiting",
      approvals: [],
    });
    const notifySpy = spy((_t: TicketState) => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      notify: notifySpy,
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertSpyCalls(notifySpy, 0);
  },
);

Deno.test(
  "TickService: proceeds normally when notify is absent",
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "implementation",
      status: "needs-attention",
    });
    const commitSpy = spy(() => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      commitState: commitSpy,
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertSpyCalls(commitSpy, 1);
  },
);

Deno.test(
  "TickService: notify called once per needs-attention ticket per run",
  async () => {
    const t1 = makeTicket({
      id: "gh-1",
      phase: "plan",
      status: "needs-attention",
    });
    const t2 = makeTicket({
      id: "gh-2",
      phase: "implementation",
      status: "needs-attention",
    });
    const store: Record<string, TicketState> = { "gh-1": t1, "gh-2": t2 };
    const notifySpy = spy((_t: TicketState) => Promise.resolve());
    const deps = makeFakeServiceDeps({
      listTickets: () => Promise.resolve(["gh-1", "gh-2"]),
      readTicket: (id) => Promise.resolve(store[id]),
      notify: notifySpy,
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertSpyCalls(notifySpy, 2);
  },
);

Deno.test(
  "TickService: refreshAnthropicPricing called before installPackages",
  async () => {
    const sequence: string[] = [];
    const refreshSpy = spy((): Promise<void> => {
      sequence.push("refresh");
      return Promise.resolve();
    });
    const deps = makeFakeServiceDeps({
      refreshAnthropicPricing: refreshSpy,
      installPackages: spy(() => {
        sequence.push("install");
        return Promise.resolve([]);
      }),
    });
    await new TickService(deps).run();
    assertSpyCalls(refreshSpy, 1);
    assertEquals(sequence[0], "refresh");
    assertEquals(sequence[1], "install");
  },
);

Deno.test(
  "TickService: proceeds normally when refreshAnthropicPricing is omitted",
  async () => {
    const installPackagesSpy = spy(() => Promise.resolve([]));
    const deps = makeFakeServiceDeps({
      installPackages: installPackagesSpy,
    });
    await new TickService(deps).run();
    assertSpyCalls(installPackagesSpy, 1);
  },
);
