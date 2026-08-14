import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertExists,
  assertFalse,
  assertLess,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import {
  advancePhase,
  appendTickLog,
  selectCandidates,
  TickService,
} from "./tick.ts";
import { adjudicatePhaseModel } from "./pre-phase-adjudication.ts";
import type { TickDeps } from "./tick.ts";
import type { Lock } from "./lock.ts";
import type { TicketState } from "./state/types.ts";
import { loadPromptFile } from "./phases/runners.ts";
import {
  makeTickDeps,
  makeTicket,
  makeTickServiceDeps,
  withLazyboyDir,
} from "./test-support.ts";
import type { Provider, WorkItem } from "./providers/types.ts";

type SpawnOpts = Parameters<TickDeps["spawn"]>[0];

Deno.test("advancePhase: new ticket starts intake", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  let spawnedPhase = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedPhase = opts.phase;
    return Promise.resolve();
  });
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      writeTicket: writeTicketSpy,
    }),
  );
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "intake");
  assertEquals(written.status, "waiting");
});

Deno.test("advancePhase: implementation running with dead PID transitions to implementation/waiting", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "running",
    prs: [{ url: "u", title: "T", dependsOn: [], merged: false }],
  });
  let written = { phase: "", status: "" };
  const writeTicketSpy = spy((_dir: string, t: TicketState) => {
    written = { phase: t.phase, status: t.status };
    return Promise.resolve();
  });
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      writeTicket: writeTicketSpy,
    }),
  );
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "implementation");
  assertEquals(written.status, "waiting");
});

Deno.test("advancePhase: running phase with live PID does nothing", async () => {
  const ticket = makeTicket({ phase: "intake", status: "running" });
  const writeTicketSpy = spy((_dir: string, _t: TicketState) =>
    Promise.resolve()
  );
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      isProcessAlive: () => true,
      writeTicket: writeTicketSpy,
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
    }),
  );
  assertSpyCalls(spawnSpy, 0);
});

Deno.test(
  "advancePhase: implementation/waiting + approved with PRs advances to merge/waiting",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
      prs: [
        {
          url: "https://github.com/example/repo/pull/1",
          title: "PR",
          dependsOn: [],
          merged: false,
        },
      ],
    });
    let written = { phase: "", status: "" };
    const writeTicketSpy = spy((_dir: string, t: TicketState) => {
      written = { phase: t.phase, status: t.status };
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: writeTicketSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(writeTicketSpy, 0);
    assertEquals(written.phase, "merge");
    assertEquals(written.status, "waiting");
  },
);

Deno.test(
  "advancePhase: implementation/needs-attention + approved does not advance to merge",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "needs-attention",
      approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
    });
    const writeTicketSpy = spy((_dir: string, _t: TicketState) =>
      Promise.resolve()
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: writeTicketSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCalls(writeTicketSpy, 0);
  },
);

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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      writeTicket: writeTicketSpy,
    }),
  );
  assertSpyCall(writeTicketSpy, 0);
  assertEquals(written.phase, "implementation");
  assertEquals(written.status, "needs-attention");
});

Deno.test("advancePhase: new ticket logs status-only transition", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      appendLog: appendLogSpy,
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
  assertSpyCall(appendLogSpy, 0);
  assertEquals(appendLogSpy.calls[0].args[2], {
    event: "status-transition",
    phase: "enrichment",
    from: "running",
    to: "waiting",
  });
});

Deno.test("advancePhase: dead PID on implementation logs status-transition to waiting", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "running",
    prs: [{ url: "u", title: "T", dependsOn: [], merged: false }],
  });
  const logEntries: object[] = [];
  const appendLogSpy = spy(
    (_dir: string, _id: string, entry: object) => {
      logEntries.push(entry);
      return Promise.resolve();
    },
  );
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
  assertSpyCalls(appendLogSpy, 2);
  assertEquals(logEntries[0], {
    event: "status-transition",
    phase: "implementation",
    from: "running",
    to: "waiting",
  });
  assertEquals(logEntries[1], {
    event: "error",
    context: "spawnOutlierAnalysis",
    message: "no jackjennings/lazyboy worktree",
  });
});

Deno.test("advancePhase: live PID does not log", async () => {
  const ticket = makeTicket({ phase: "intake", status: "running" });
  const appendLogSpy = spy(
    (_dir: string, _id: string, _entry: object) => Promise.resolve(),
  );
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      isProcessAlive: () => true,
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        markPRsReady: markPRsReadySpy,
      }),
    );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        markPRsReady: markPRsReadySpy,
      }),
    );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        markPRsReady: markPRsReadySpy,
      }),
    );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        markPRsReady: markPRsReadySpy,
      }),
    );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: writeTicketSpy,
        appendLog: appendLogSpy2,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        markPRsReady: () => Promise.reject(new Error("API error")),
      }),
    );
    assertSpyCall(writeTicketSpy, 0);
    assertEquals(writtenTickets[0].phase, "merge");
    assertEquals(writtenTickets[0].status, "waiting");
    assert(
      logEntries2.some(
        (e) =>
          (e as Record<string, unknown>).event === "error" &&
          (e as Record<string, unknown>).context === "markPRsReady",
      ),
    );
  },
);

Deno.test("implementation.md contains explicit draft PR instruction", async () => {
  const content = await Deno.readTextFile(
    new URL("./phases/prompts/implementation.md", import.meta.url).pathname,
  );
  assertStringIncludes(content, "pull requests in draft mode");
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
  assertSpyCalls(appendLogSpy, 1);
  assertEquals(logEntries[0], {
    event: "phase-transition",
    from: "plan",
    to: "needs-attention",
    reason: "no-worktrees",
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
  assertSpyCalls(appendLogSpy, 1);
  assertFalse("ts" in logEntries[0]);
});

Deno.test("advancePhase: revising status spawns plan with timestamped outputFile", async () => {
  const ticket = makeTicket({ phase: "plan", status: "revising" });
  let spawnedOutputFile = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve();
  });
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
  assertSpyCall(spawnSpy, 0);
  assert(/^\d{8}T\d{6}-plan\.md$/.test(spawnedOutputFile));
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      writeTicket: writeTicketSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      appendLog: appendLogSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
  assertSpyCall(spawnSpy, 0);
  assert(/^\d{8}T\d{6}-plan\.md$/.test(spawnedOutputFile ?? ""));
});

Deno.test("advancePhase: new status spawn receives timestamp-prefixed intake output filename", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  let spawnedOutputFile = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedOutputFile = opts.outputFile;
    return Promise.resolve();
  });
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
  assertSpyCall(spawnSpy, 0);
  assert(/^\d{8}T\d{6}-intake\.md$/.test(spawnedOutputFile));
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
  assertSpyCall(spawnSpy, 0);
  assert(/^\d{8}T\d{6}-enrichment\.md$/.test(spawnedOutputFile ?? ""));
});

Deno.test(
  "advancePhase: running phase with dead PID and missing output transitions to needs-attention",
  async () => {
    const ticket = makeTicket({ phase: "spec", status: "running" });
    const writtenTickets: TicketState[] = [];
    const logs: object[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        appendLog: (_dir, _id, entry) => {
          logs.push(entry);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        readPhaseOutput: () => Promise.resolve(null),
      }),
    );
    const final = writtenTickets[writtenTickets.length - 1];
    assertEquals(final.status, "needs-attention");
    const invalidLog = logs.find(
      (e) => (e as Record<string, unknown>).event === "phase-output-invalid",
    );
    assertEquals((invalidLog as Record<string, unknown>).reason, "missing");
  },
);

Deno.test(
  "advancePhase: valid output with outputRetries clears it on waiting ticket",
  async () => {
    const ticket = makeTicket({
      phase: "spec",
      status: "running",
      outputRetries: 1,
    });
    const writtenTickets: TicketState[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        readPhaseOutput: () => Promise.resolve("## What to Build\n\ncontent"),
      }),
    );
    const waitingWrite = writtenTickets.find((t) => t.status === "waiting");
    assertEquals(waitingWrite?.outputRetries, undefined);
  },
);

Deno.test(
  "advancePhase: running phase with dead PID and empty output transitions to needs-attention",
  async () => {
    const ticket = makeTicket({ phase: "spec", status: "running" });
    const writtenTickets: TicketState[] = [];
    const logs: object[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        appendLog: (_dir, _id, entry) => {
          logs.push(entry);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        readPhaseOutput: () => Promise.resolve("   \n  "),
      }),
    );
    const final = writtenTickets[writtenTickets.length - 1];
    assertEquals(final.status, "needs-attention");
    const invalidLog = logs.find(
      (e) => (e as Record<string, unknown>).event === "phase-output-invalid",
    );
    assertEquals((invalidLog as Record<string, unknown>).reason, "empty");
  },
);

Deno.test(
  "advancePhase: running phase with dead PID and valid output does not transition to needs-attention",
  async () => {
    const ticket = makeTicket({ phase: "spec", status: "running" });
    const writtenTickets: TicketState[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        readPhaseOutput: () => Promise.resolve("## What to Build\n\ncontent"),
      }),
    );
    const final = writtenTickets[writtenTickets.length - 1];
    assertEquals(final.status, "waiting");
  },
);

Deno.test(
  "advancePhase: calls appendPrinciples when output has ## Principles",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const appendPrinciplesSpy = spy(() => Promise.resolve());
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        readPhaseOutput: () => Promise.resolve("## Principles\n\nlearn X"),
        appendPrinciples: appendPrinciplesSpy,
      }),
    );
    assertSpyCalls(appendPrinciplesSpy, 1);
  },
);

Deno.test(
  "advancePhase: does not call appendPrinciples when output has no ## Principles",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const appendPrinciplesSpy = spy(() => Promise.resolve());
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        readPhaseOutput: () => Promise.resolve("## What to Build\n\nstuff"),
        appendPrinciples: appendPrinciplesSpy,
      }),
    );
    assertSpyCalls(appendPrinciplesSpy, 0);
  },
);

Deno.test(
  "advancePhase: does not call appendPrinciples when readPhaseOutput returns null",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const appendPrinciplesSpy = spy(() => Promise.resolve());
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        readPhaseOutput: () => Promise.resolve(null),
        appendPrinciples: appendPrinciplesSpy,
      }),
    );
    assertSpyCalls(appendPrinciplesSpy, 0);
  },
);

Deno.test(
  "advancePhase: null readPhaseExitCode → needs-attention with reason incomplete",
  async () => {
    const ticket = makeTicket({ phase: "spec", status: "running" });
    const writtenTickets: TicketState[] = [];
    const logs: object[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        appendLog: (_dir, _id, entry) => {
          logs.push(entry);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        readPhaseOutput: () => Promise.resolve("some content"),
        readPhaseExitCode: () => Promise.resolve(null),
      }),
    );
    const final = writtenTickets[writtenTickets.length - 1];
    assertEquals(final.status, "needs-attention");
    const invalidLog = logs.find(
      (e) => (e as Record<string, unknown>).event === "phase-output-invalid",
    );
    assertEquals((invalidLog as Record<string, unknown>).reason, "incomplete");
  },
);

Deno.test(
  "advancePhase: running→waiting stores session ID from sidecar in phaseSessionIds",
  async () => {
    const ticket = makeTicket({ phase: "spec", status: "running" });
    const writtenTickets: TicketState[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        readPhaseOutput: () => Promise.resolve("## What to Build\n\ncontent"),
        readPhaseSessionId: (_dir, _phase) => Promise.resolve("sess-xyz"),
      }),
    );
    const waitingWrite = writtenTickets.find((t) => t.status === "waiting");
    assertEquals(waitingWrite?.phaseSessionIds?.["spec"], "sess-xyz");
  },
);

Deno.test(
  "advancePhase: implementation revision passes phaseSessionIds.implementation as sessionId to spawn",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "revising",
      worktrees: { "jackjennings/lazyboy": { path: "/wt", branch: "b" } },
      phaseSessionIds: { implementation: "sess-impl" },
    });
    let spawnedSessionId: string | undefined;
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedSessionId = opts.sessionId;
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    assertEquals(spawnedSessionId, "sess-impl");
  },
);

Deno.test(
  "advancePhase: implementation revision with no phaseSessionIds spawns without sessionId",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "revising",
      worktrees: { "jackjennings/lazyboy": { path: "/wt", branch: "b" } },
    });
    let spawnedSessionId: string | undefined = "sentinel";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedSessionId = opts.sessionId;
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    assertEquals(spawnedSessionId, undefined);
  },
);

Deno.test(
  "advancePhase: non-implementation revision spawns without sessionId regardless of phaseSessionIds",
  async () => {
    const ticket = makeTicket({
      phase: "spec",
      status: "revising",
      phaseSessionIds: { implementation: "sess-impl" },
    });
    let spawnedSessionId: string | undefined = "sentinel";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedSessionId = opts.sessionId;
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    assertEquals(spawnedSessionId, undefined);
  },
);

Deno.test(
  "advancePhase: merge revision passes phaseSessionIds.implementation as sessionId to spawn",
  async () => {
    const ticket = makeTicket({
      phase: "merge",
      status: "revising",
      worktrees: { "jackjennings/lazyboy": { path: "/wt", branch: "b" } },
      phaseSessionIds: { implementation: "sess-merge-impl" },
    });
    let spawnedSessionId: string | undefined;
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedSessionId = opts.sessionId;
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    assertEquals(spawnedSessionId, "sess-merge-impl");
  },
);

Deno.test(
  "advancePhase: merge revision with no phaseSessionIds spawns without sessionId",
  async () => {
    const ticket = makeTicket({
      phase: "merge",
      status: "revising",
      worktrees: { "jackjennings/lazyboy": { path: "/wt", branch: "b" } },
    });
    let spawnedSessionId: string | undefined = "sentinel";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedSessionId = opts.sessionId;
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    assertEquals(spawnedSessionId, undefined);
  },
);

Deno.test(
  "advancePhase: missing output with phaseSessionIds spawns recovery and stays running",
  async () => {
    const ticket = makeTicket({
      phase: "spec",
      status: "running",
      phaseSessionIds: { spec: "sess-recover" },
    });
    const writtenTickets: TicketState[] = [];
    const logs: object[] = [];
    let spawnedSessionId: string | undefined;
    let spawnedScope: string[] | undefined;
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: (opts) => {
          spawnedSessionId = opts.sessionId;
          spawnedScope = opts.scope;
          return Promise.resolve();
        },
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        appendLog: (_dir, _id, entry) => {
          logs.push(entry);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        readPhaseOutput: () => Promise.resolve(null),
        readPhaseSessionId: (_dir, _phase) => Promise.resolve("sess-recover"),
      }),
    );
    const final = writtenTickets[writtenTickets.length - 1];
    assertEquals(final.status, "running");
    assertEquals(final.outputRetries, 1);
    assertEquals(spawnedSessionId, "sess-recover");
    assertEquals(spawnedScope, []);
    const retryLog = logs.find(
      (e) => (e as Record<string, unknown>).event === "phase-output-retry",
    );
    assertEquals((retryLog as Record<string, unknown>).phase, "spec");
    assertEquals((retryLog as Record<string, unknown>).attempt, 1);
  },
);

Deno.test(
  "advancePhase: revising→running clears notifiedNeedsAttention",
  async () => {
    const ticket = makeTicket({
      phase: "spec",
      status: "revising",
      notifiedNeedsAttention: true,
    });
    const writtenTickets: TicketState[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    const runningWrite = writtenTickets.find((t) => t.status === "running");
    assertEquals(runningWrite?.notifiedNeedsAttention, false);
  },
);

Deno.test(
  "advancePhase: non-zero exit code transitions to needs-attention regardless of output content",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writtenTickets: TicketState[] = [];
    const logs: object[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        appendLog: (_dir, _id, entry) => {
          logs.push(entry);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        readPhaseOutput: () => Promise.resolve("some content"),
        readPhaseExitCode: () => Promise.resolve(1),
      }),
    );
    const final = writtenTickets[writtenTickets.length - 1];
    assertEquals(final.status, "needs-attention");
    assertEquals(
      logs.some(
        (e) =>
          (e as Record<string, unknown>).event === "phase-output-invalid" &&
          (e as Record<string, unknown>).reason === "non-zero-exit",
      ),
      true,
    );
  },
);

Deno.test(
  "advancePhase: zero exit code falls through to existing output checks",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writtenTickets: TicketState[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        readPhaseOutput: () => Promise.resolve("good content"),
      }),
    );
    assertEquals(writtenTickets[writtenTickets.length - 1].status, "waiting");
  },
);

Deno.test(
  "advancePhase: empty output with exit code 0 goes to needs-attention with reason empty",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writtenTickets: TicketState[] = [];
    const logs: object[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        appendLog: (_dir, _id, entry) => {
          logs.push(entry);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        readPhaseOutput: () => Promise.resolve(""),
      }),
    );
    assertEquals(
      writtenTickets[writtenTickets.length - 1].status,
      "needs-attention",
    );
    assertEquals(
      logs.some(
        (e) =>
          (e as Record<string, unknown>).event === "phase-output-invalid" &&
          (e as Record<string, unknown>).reason === "empty",
      ),
      true,
    );
  },
);

Deno.test(
  "advancePhase: feedback immediately preceding output suppresses self-review",
  async () => {
    const stateDir = Deno.makeTempDirSync();
    try {
      const ticket = makeTicket({ phase: "spec", status: "running" });
      const ticketDir = join(stateDir, ticket.id);
      await Deno.mkdir(ticketDir, { recursive: true });
      await Deno.writeTextFile(
        join(ticketDir, "20260101T100000-spec-feedback.md"),
        "feedback",
      );
      await Deno.writeTextFile(
        join(ticketDir, "20260101T100001-spec.md"),
        "content",
      );
      const selfReviewSpy = spy(() =>
        Promise.resolve({ approved: false, reason: null })
      );
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          ...makeTickDeps(),
          selfReview: selfReviewSpy,
        }),
      );
      assertSpyCalls(selfReviewSpy, 0);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "advancePhase: no feedback before output calls self-review normally",
  async () => {
    const stateDir = Deno.makeTempDirSync();
    try {
      const ticket = makeTicket({ phase: "spec", status: "running" });
      const ticketDir = join(stateDir, ticket.id);
      await Deno.mkdir(ticketDir, { recursive: true });
      await Deno.writeTextFile(
        join(ticketDir, "20260101T100001-spec.md"),
        "content",
      );
      const selfReviewSpy = spy(() =>
        Promise.resolve({ approved: false, reason: null })
      );
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          ...makeTickDeps(),
          selfReview: selfReviewSpy,
        }),
      );
      assertSpyCalls(selfReviewSpy, 1);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "advancePhase: feedback not immediately preceding output calls self-review normally",
  async () => {
    const stateDir = Deno.makeTempDirSync();
    try {
      const ticket = makeTicket({ phase: "spec", status: "running" });
      const ticketDir = join(stateDir, ticket.id);
      await Deno.mkdir(ticketDir, { recursive: true });
      await Deno.writeTextFile(
        join(ticketDir, "20260101T100000-spec-feedback.md"),
        "feedback",
      );
      await Deno.writeTextFile(
        join(ticketDir, "20260101T100001-spec.md"),
        "first output",
      );
      await Deno.writeTextFile(
        join(ticketDir, "20260101T100002-spec.md"),
        "second output",
      );
      const selfReviewSpy = spy(() =>
        Promise.resolve({ approved: false, reason: null })
      );
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          ...makeTickDeps(),
          selfReview: selfReviewSpy,
          readPhaseOutput: () => Promise.resolve("second output"),
        }),
      );
      assertSpyCalls(selfReviewSpy, 1);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

// ── appendTickLog ─────────────────────────────────────────────────────────────

Deno.test("appendTickLog: writes to combined log without id field", async () => {
  using lazy = withLazyboyDir();
  await appendTickLog({ event: "tick-failed", error: "boom" });
  const combined = await Deno.readTextFile(
    join(lazy.path, "log.ndjson"),
  );
  const parsed = JSON.parse(combined.trim());
  assertEquals(parsed.event, "tick-failed");
  assertEquals(parsed.id, undefined);
});

Deno.test("appendTickLog: tick log entry is unchanged", async () => {
  using lazy = withLazyboyDir();
  await appendTickLog({ event: "stale-lock" });
  const tick = await Deno.readTextFile(
    join(lazy.path, "tick.ndjson"),
  );
  const parsed = JSON.parse(tick.trim());
  assertEquals(parsed.event, "stale-lock");
  assertEquals(parsed.id, undefined);
});

Deno.test("appendTickLog: tick log write succeeds when combined log write fails", async () => {
  using lazy = withLazyboyDir();
  await Deno.mkdir(join(lazy.path, "log.ndjson"), { recursive: true });
  await appendTickLog({ event: "tick-already-running" });
  const tick = await Deno.readTextFile(
    join(lazy.path, "tick.ndjson"),
  );
  assertEquals(JSON.parse(tick.trim()).event, "tick-already-running");
});

// ── TickService ────────────────────────────────────────────────────────────────

Deno.test("TickService: lock.withLock called once per run()", async () => {
  let calls = 0;
  const lock: Lock = {
    withLock: async (fn) => {
      calls++;
      await fn();
    },
  };
  const deps = makeTickServiceDeps({ lock });
  await new TickService(deps).run();
  assertEquals(calls, 1);
});

Deno.test(
  "TickService: workflow does not run if lock.withLock does not call fn",
  async () => {
    const listTicketsSpy = spy(() => Promise.resolve([]));
    const lock: Lock = { withLock: (_fn) => Promise.resolve() };
    const deps = makeTickServiceDeps({ lock, listTickets: listTicketsSpy });
    await new TickService(deps).run();
    assertSpyCalls(listTicketsSpy, 0);
  },
);

Deno.test(
  "TickService: installPackages called with packageSources before listTickets",
  async () => {
    const sequence: string[] = [];
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
  "TickService: ticket-captured logged for each new item",
  async () => {
    const item: WorkItem = {
      id: "gh-2",
      provider: "github",
      title: "Fix the bug",
      url: "https://github.com/t/r/issues/2",
      description: "body",
    };
    const provider: Provider = {
      fetchNew: () => Promise.resolve([item]),
      close: () => Promise.resolve(),
    };
    const appendLogSpy = spy(() => Promise.resolve());
    const deps = makeTickServiceDeps({
      providers: [provider],
      listTickets: () => Promise.resolve([]),
      tickDeps: makeTickDeps({ ...makeTickDeps(), appendLog: appendLogSpy }),
    });
    await new TickService(deps).run();
    assertSpyCalls(appendLogSpy, 1);
    assertEquals(appendLogSpy.calls[0].args, [
      "/state",
      "gh-2",
      { event: "ticket-captured", title: "Fix the bug" },
    ]);
  },
);

Deno.test(
  "TickService: ticket-captured not logged when writeTicket throws",
  async () => {
    const item: WorkItem = {
      id: "gh-2",
      provider: "github",
      title: "Fix the bug",
      url: "https://github.com/t/r/issues/2",
      description: "body",
    };
    const provider: Provider = {
      fetchNew: () => Promise.resolve([item]),
      close: () => Promise.resolve(),
    };
    const appendLogSpy = spy(() => Promise.resolve());
    const deps = makeTickServiceDeps({
      providers: [provider],
      listTickets: () => Promise.resolve([]),
      writeTicket: () => Promise.reject(new Error("write failed")),
      tickDeps: makeTickDeps({ ...makeTickDeps(), appendLog: appendLogSpy }),
      exit: () => {},
    });
    await new TickService(deps).run();
    assertSpyCalls(appendLogSpy, 0);
  },
);

Deno.test(
  "TickService: runMigrations called before tick actions",
  async () => {
    const sequence: string[] = [];
    const ticket = makeTicket({ id: "gh-1", phase: "intake", status: "new" });
    const deps = makeTickServiceDeps({
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
    assertLess(sequence.indexOf("migrate"), sequence.indexOf("action"));
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
    const deps = makeTickServiceDeps({
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
  "TickService: tick actions skipped for wont-do tickets",
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "wont-do",
      status: "done",
    });
    const appliesSpy = spy((_t: TicketState) => true);
    const runSpy = spy(
      (_t: TicketState, _sd: string) =>
        Promise.resolve<TicketState | null>(null),
    );
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      tickActions: [{ applies: appliesSpy, run: runSpy }],
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertSpyCalls(appliesSpy, 0);
    assertSpyCalls(runSpy, 0);
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.resolve(["gh-1", "gh-2"]),
      readTicket: (id) => Promise.resolve(store[id]),
      tickDeps: makeTickDeps({
        isProcessAlive: (id) => id === "gh-1",
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
    assertLess(
      sequence.indexOf("writeLastWorked"),
      sequence.indexOf("commitState"),
    );
  },
);

Deno.test("TickService: exit(1) called when workflow throws", async () => {
  const exitSpy = spy((_code: number) => {});
  const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.reject(new Error("workflow error")),
      appendTickLog: (entry) => {
        captured.push(entry);
        return Promise.resolve();
      },
      exit: () => {},
    });
    await new TickService(deps).run();
    assertEquals(captured.length, 2);
    assertEquals((captured[0] as Record<string, unknown>).event, "tick-start");
    const entry = captured[1] as Record<string, unknown>;
    assertEquals(entry.event, "tick-failed");
    assertEquals(entry.error, "workflow error");
    assertEquals(typeof entry.ts, "string");
  },
);

Deno.test(
  "TickService: writes tick-start then tick-end on successful workflow",
  async () => {
    const captured: object[] = [];
    const deps = makeTickServiceDeps({
      appendTickLog: (entry) => {
        captured.push(entry);
        return Promise.resolve();
      },
    });
    await new TickService(deps).run();
    assertEquals(captured.length, 2);
    assertEquals((captured[0] as Record<string, unknown>).event, "tick-start");
    assertEquals((captured[1] as Record<string, unknown>).event, "tick-end");
  },
);

Deno.test(
  "TickService: installPackages called before lock fn is invoked",
  async () => {
    const sequence: string[] = [];
    const lock: Lock = {
      withLock: async (fn) => {
        sequence.push("lockFn");
        await fn();
      },
    };
    const deps = makeTickServiceDeps({
      lock,
      installPackages: spy(() => {
        sequence.push("install");
        return Promise.resolve([]);
      }),
    });
    await new TickService(deps).run();
    assertLess(sequence.indexOf("install"), sequence.indexOf("lockFn"));
  },
);

Deno.test(
  "TickService: lock fn not called when installPackages throws",
  async () => {
    let lockFnCalled = false;
    const lock: Lock = {
      withLock: async (fn) => {
        lockFnCalled = true;
        await fn();
      },
    };
    const deps = makeTickServiceDeps({
      lock,
      installPackages: () => Promise.reject(new Error("install failed")),
      exit: () => {},
    });
    await new TickService(deps).run();
    assertFalse(lockFnCalled);
  },
);

Deno.test(
  "TickService: lock fn not called when refreshAnthropicPricing throws",
  async () => {
    let lockFnCalled = false;
    const lock: Lock = {
      withLock: async (fn) => {
        lockFnCalled = true;
        await fn();
      },
    };
    const deps = makeTickServiceDeps({
      lock,
      refreshAnthropicPricing: () =>
        Promise.reject(new Error("pricing failed")),
      exit: () => {},
    });
    await new TickService(deps).run();
    assertFalse(lockFnCalled);
  },
);

Deno.test(
  "TickService: fills both concurrency slots when all running tickets have dead PIDs",
  async () => {
    const running1 = makeTicket({
      id: "gh-1",
      phase: "intake",
      status: "running",
    });
    const running2 = makeTicket({
      id: "gh-2",
      phase: "intake",
      status: "running",
    });
    const candidate1 = makeTicket({
      id: "gh-3",
      phase: "intake",
      status: "new",
    });
    const candidate2 = makeTicket({
      id: "gh-4",
      phase: "intake",
      status: "new",
    });
    const store: Record<string, TicketState> = {
      "gh-1": running1,
      "gh-2": running2,
      "gh-3": candidate1,
      "gh-4": candidate2,
    };
    const spawnSpy = spy((_opts: SpawnOpts) => Promise.resolve());
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.resolve(["gh-1", "gh-2", "gh-3", "gh-4"]),
      readTicket: (id) => Promise.resolve(store[id]),
      concurrency: 2,
      tickDeps: makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    });
    await new TickService(deps).run();
    assertSpyCalls(spawnSpy, 2);
  },
);

Deno.test(
  "TickService: fills one concurrency slot when one running ticket is alive and one is dead",
  async () => {
    const running1 = makeTicket({
      id: "gh-1",
      phase: "intake",
      status: "running",
    });
    const running2 = makeTicket({
      id: "gh-2",
      phase: "intake",
      status: "running",
    });
    const candidate1 = makeTicket({
      id: "gh-3",
      phase: "intake",
      status: "new",
    });
    const candidate2 = makeTicket({
      id: "gh-4",
      phase: "intake",
      status: "new",
    });
    const store: Record<string, TicketState> = {
      "gh-1": running1,
      "gh-2": running2,
      "gh-3": candidate1,
      "gh-4": candidate2,
    };
    const spawnSpy = spy((_opts: SpawnOpts) => Promise.resolve());
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.resolve(["gh-1", "gh-2", "gh-3", "gh-4"]),
      readTicket: (id) => Promise.resolve(store[id]),
      concurrency: 2,
      tickDeps: makeTickDeps({
        spawn: spawnSpy,
        isProcessAlive: (id) => id === "gh-1",
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    });
    await new TickService(deps).run();
    assertSpyCalls(spawnSpy, 1);
  },
);

Deno.test(
  "TickService: notifyTickFailure called with error message when workflow throws",
  async () => {
    const captured: string[] = [];
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.reject(new Error("auth failure")),
      notifyTickFailure: (error) => {
        captured.push(error);
        return Promise.resolve();
      },
      exit: () => {},
    });
    await new TickService(deps).run();
    assertEquals(captured, ["auth failure"]);
  },
);

Deno.test(
  "TickService: notifyTickFailure called with String(e) when non-Error thrown",
  async () => {
    const captured: string[] = [];
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.reject("raw string error"),
      notifyTickFailure: (error) => {
        captured.push(error);
        return Promise.resolve();
      },
      exit: () => {},
    });
    await new TickService(deps).run();
    assertEquals(captured, ["raw string error"]);
  },
);

Deno.test(
  "TickService: notifyTickFailure called for pre-lock failures",
  async () => {
    const captured: string[] = [];
    const deps = makeTickServiceDeps({
      installPackages: () => Promise.reject(new Error("install failed")),
      notifyTickFailure: (error) => {
        captured.push(error);
        return Promise.resolve();
      },
      exit: () => {},
    });
    await new TickService(deps).run();
    assertEquals(captured, ["install failed"]);
  },
);

Deno.test(
  "TickService: exit(1) still fires when notifyTickFailure throws",
  async () => {
    const exitSpy = spy((_code: number) => {});
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.reject(new Error("workflow error")),
      notifyTickFailure: () => Promise.reject(new Error("notify failed")),
      exit: exitSpy,
    });
    await new TickService(deps).run();
    assertSpyCall(exitSpy, 0, { args: [1] });
  },
);

Deno.test(
  "TickService: proceeds normally when notifyTickFailure is absent",
  async () => {
    const exitSpy = spy((_code: number) => {});
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.reject(new Error("workflow error")),
      exit: exitSpy,
    });
    await new TickService(deps).run();
    assertSpyCall(exitSpy, 0, { args: [1] });
  },
);

Deno.test(
  "TickService: action.run throwing is caught, error logged, loop continues to next action",
  async () => {
    const ticket = makeTicket({ id: "gh-1", phase: "intake", status: "new" });
    const appendLogSpy = spy(
      (_stateDir: string, _id: string, _entry: object) => Promise.resolve(),
    );
    const runSpy = spy(
      (_t: TicketState, _sd: string) =>
        Promise.resolve<TicketState | null>(null),
    );
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      tickActions: [
        { applies: () => true, run: () => Promise.reject(new Error("boom")) },
        { applies: () => true, run: runSpy },
      ],
      tickDeps: makeTickDeps({ ...makeTickDeps(), appendLog: appendLogSpy }),
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertSpyCalls(runSpy, 1);
    const errorCalls = appendLogSpy.calls.filter(
      (c) => (c.args[2] as { event: string }).event === "error",
    );
    assertEquals(errorCalls.length, 1);
    assertEquals(
      (errorCalls[0].args[2] as { context: string }).context,
      "tickAction",
    );
    assertStringIncludes(
      String((errorCalls[0].args[2] as { message: string }).message),
      "boom",
    );
  },
);

Deno.test(
  "TickService: action.applies throwing is caught, error logged, loop continues",
  async () => {
    const ticket = makeTicket({ id: "gh-1", phase: "intake", status: "new" });
    const appendLogSpy = spy(
      (_stateDir: string, _id: string, _entry: object) => Promise.resolve(),
    );
    const runSpy = spy(
      (_t: TicketState, _sd: string) =>
        Promise.resolve<TicketState | null>(null),
    );
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      tickActions: [
        {
          applies: () => {
            throw new Error("applies boom");
          },
          run: () => Promise.resolve(null),
        },
        { applies: () => true, run: runSpy },
      ],
      tickDeps: makeTickDeps({ ...makeTickDeps(), appendLog: appendLogSpy }),
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertSpyCalls(runSpy, 1);
    const errorCalls = appendLogSpy.calls.filter(
      (c) => (c.args[2] as { event: string }).event === "error",
    );
    assertEquals(errorCalls.length, 1);
    assertEquals(
      (errorCalls[0].args[2] as { context: string }).context,
      "tickAction",
    );
    assertStringIncludes(
      String((errorCalls[0].args[2] as { message: string }).message),
      "applies boom",
    );
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

Deno.test("advancePhase: spawn receives model and thinking from resolveModelConfig", async () => {
  const ticket = makeTicket({ phase: "intake", status: "new" });
  let spawnedModel = "";
  let spawnedThinking = "";
  const spawnSpy = spy((opts: SpawnOpts) => {
    spawnedModel = opts.model;
    spawnedThinking = opts.thinking;
    return Promise.resolve();
  });
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
      resolveModelConfig: () => ({ model: "claude-opus-4-7", thinking: "max" }),
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      resolveModelConfig: (phase, _t) => {
        resolvedPhase = phase;
        return { model: "m", thinking: "off" };
      },
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
      writeTicket: async () => {},
      writePhaseOutput: async () => {},
      appendLog: async () => {},
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
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
  await advancePhase(
    ticket,
    "/state",
    makeTickDeps({
      spawn: spawnSpy,
      writeTicket: async () => {},
      writePhaseOutput: async () => {},
      appendLog: async () => {},
      resolveModelConfig: () => ({ model: "m", thinking: "off" }),
    }),
  );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: writeTicketSpy,
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        selfReview: () => Promise.resolve({ approved: true, reason: null }),
      }),
    );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: writeTicketSpy,
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: writeTicketSpy,
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        selfReview: () => Promise.reject(new Error("review exploded")),
      }),
    );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: writeTicketSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    assertSpyCalls(writeTicketSpy, 1);
    assertEquals(writtenTickets[0].approvals, []);
  },
);

Deno.test(
  "advancePhase: selfReview returning reason writes self-review output file",
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "intake",
      status: "running",
    });
    const writePhaseOutputCalls: Array<[string, string, string, string]> = [];
    const writePhaseOutputSpy = spy(
      (stateDir: string, id: string, file: string, content: string) => {
        writePhaseOutputCalls.push([stateDir, id, file, content]);
        return Promise.resolve();
      },
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writePhaseOutput: writePhaseOutputSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        selfReview: () =>
          Promise.resolve({
            approved: false,
            reason: "REJECT\nCriterion 1 violated.",
          }),
      }),
    );
    assertSpyCalls(writePhaseOutputSpy, 1);
    assertEquals(writePhaseOutputCalls[0][0], "/state");
    assertEquals(writePhaseOutputCalls[0][1], "gh-1");
    assert(
      /^\d{8}T\d{6}-intake-self-review\.md$/.test(
        writePhaseOutputCalls[0][2],
      ),
    );
    assertEquals(writePhaseOutputCalls[0][3], "REJECT\nCriterion 1 violated.");
  },
);

Deno.test(
  "advancePhase: selfReview returning null reason does not write output file",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writePhaseOutputSpy = spy(() => Promise.resolve());
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writePhaseOutput: writePhaseOutputSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        selfReview: selfReviewSpy,
      }),
    );
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    const supplement = await Deno.readTextFile(
      new URL(
        "./phases/prompts/github-implementation.md",
        import.meta.url,
      ).pathname,
    );
    assertStringIncludes(spawnedPrompt, supplement.trim());
    assertStringIncludes(spawnedPrompt, "\n\n");
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    const supplement = await Deno.readTextFile(
      new URL(
        "./phases/prompts/github-implementation.md",
        import.meta.url,
      ).pathname,
    );
    assertStringIncludes(spawnedPrompt, supplement.trim());
    assertFalse(supplement.includes("gh pr create"));
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    const basePrompt = await loadPromptFile("implementation.md");
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    const basePrompt = await loadPromptFile("intake.md");
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        buildRepoCorpusText: () =>
          Promise.resolve(
            "## Available Repositories\n\n- myorg/frontend (checked out at /code/myorg/frontend)\n",
          ),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    const basePrompt = await loadPromptFile("intake.md");
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
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    const basePrompt = await loadPromptFile("intake.md");
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
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
  "TickService: skips notification when notifiedNeedsAttention is true",
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "implementation",
      status: "needs-attention",
      notifiedNeedsAttention: true,
    });
    const notifySpy = spy((_t: TicketState) => Promise.resolve());
    const deps = makeTickServiceDeps({
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
  "TickService: sets notifiedNeedsAttention after notifying",
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "implementation",
      status: "needs-attention",
    });
    const writtenTickets: TicketState[] = [];
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: () => Promise.resolve(ticket),
      notify: (_t) => Promise.resolve(),
      writeTicket: (t) => {
        writtenTickets.push(t);
        return Promise.resolve();
      },
      concurrency: 0,
    });
    await new TickService(deps).run();
    const notifiedWrite = writtenTickets.find((t) =>
      t.notifiedNeedsAttention === true
    );
    assertEquals(notifiedWrite?.id, "gh-1");
  },
);

Deno.test(
  "TickService: notify skipped when fresh read shows ticket no longer needs attention",
  async () => {
    const snapshotTicket = makeTicket({
      id: "gh-1",
      phase: "implementation",
      status: "needs-attention",
    });
    const freshTicket = makeTicket({
      id: "gh-1",
      phase: "implementation",
      status: "waiting",
    });
    let readCount = 0;
    const notifySpy = spy((_t: TicketState) => Promise.resolve());
    const writeTicketSpy = spy((_t: TicketState) => Promise.resolve());
    const deps = makeTickServiceDeps({
      listTickets: () => Promise.resolve(["gh-1"]),
      readTicket: (_id) => {
        readCount++;
        return Promise.resolve(readCount === 1 ? snapshotTicket : freshTicket);
      },
      notify: notifySpy,
      writeTicket: writeTicketSpy,
      concurrency: 0,
    });
    await new TickService(deps).run();
    assertSpyCalls(notifySpy, 0);
    assertSpyCalls(writeTicketSpy, 0);
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
    const deps = makeTickServiceDeps({
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
    const deps = makeTickServiceDeps({
      installPackages: installPackagesSpy,
    });
    await new TickService(deps).run();
    assertSpyCalls(installPackagesSpy, 1);
  },
);

Deno.test(
  "advancePhase: implementation/running with dead PID calls spawnOutlierAnalysis with ticket id, dir, worktree path, and phase",
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "implementation",
      status: "running",
      prs: [{ url: "u", title: "T", dependsOn: [], merged: false }],
      worktrees: {
        "jackjennings/lazyboy": { path: "/wt/path", branch: "gh-1" },
      },
    });
    const calls: Array<[string, string, string, string]> = [];
    const spawnOutlierAnalysisSpy = spy(
      (
        ticketId: string,
        ticketDir: string,
        worktreePath: string,
        phase: string,
      ) => {
        calls.push([ticketId, ticketDir, worktreePath, phase]);
        return Promise.resolve();
      },
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        spawnOutlierAnalysis: spawnOutlierAnalysisSpy,
      }),
    );
    assertSpyCalls(spawnOutlierAnalysisSpy, 1);
    assertEquals(calls[0][0], "gh-1");
    assertEquals(calls[0][1], "/state/gh-1");
    assertEquals(calls[0][2], "/wt/path");
    assertEquals(calls[0][3], "implementation");
  },
);

Deno.test(
  "advancePhase: implementation/running with dead PID and no lazyboy worktree logs error and does not call spawnOutlierAnalysis",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "running",
      prs: [{ url: "u", title: "T", dependsOn: [], merged: false }],
      worktrees: {},
    });
    const spawnOutlierAnalysisSpy = spy(() => Promise.resolve());
    const logEntries: object[] = [];
    const appendLogSpy = spy(
      (_dir: string, _id: string, entry: object) => {
        logEntries.push(entry);
        return Promise.resolve();
      },
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        spawnOutlierAnalysis: spawnOutlierAnalysisSpy,
      }),
    );
    assertSpyCalls(spawnOutlierAnalysisSpy, 0);
    assert(
      logEntries.some(
        (e) =>
          (e as Record<string, unknown>).event === "error" &&
          (e as Record<string, unknown>).context === "spawnOutlierAnalysis",
      ),
    );
  },
);

Deno.test(
  'advancePhase: plan/running with dead PID calls spawnOutlierAnalysis with phase "plan"',
  async () => {
    const ticket = makeTicket({
      id: "gh-1",
      phase: "plan",
      status: "running",
      worktrees: {
        "jackjennings/lazyboy": { path: "/wt/path", branch: "gh-1" },
      },
    });
    const calls: Array<[string, string, string, string]> = [];
    const spawnOutlierAnalysisSpy = spy(
      (
        ticketId: string,
        ticketDir: string,
        worktreePath: string,
        phase: string,
      ) => {
        calls.push([ticketId, ticketDir, worktreePath, phase]);
        return Promise.resolve();
      },
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        spawnOutlierAnalysis: spawnOutlierAnalysisSpy,
      }),
    );
    assertSpyCalls(spawnOutlierAnalysisSpy, 1);
    assertEquals(calls[0][0], "gh-1");
    assertEquals(calls[0][1], "/state/gh-1");
    assertEquals(calls[0][2], "/wt/path");
    assertEquals(calls[0][3], "plan");
  },
);

Deno.test(
  "advancePhase: plan/running with dead PID and no lazyboy worktree logs error and does not call spawnOutlierAnalysis",
  async () => {
    const ticket = makeTicket({
      phase: "plan",
      status: "running",
      worktrees: {},
    });
    const spawnOutlierAnalysisSpy = spy(() => Promise.resolve());
    const logEntries: object[] = [];
    const appendLogSpy = spy(
      (_dir: string, _id: string, entry: object) => {
        logEntries.push(entry);
        return Promise.resolve();
      },
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        spawnOutlierAnalysis: spawnOutlierAnalysisSpy,
      }),
    );
    assertSpyCalls(spawnOutlierAnalysisSpy, 0);
    assert(
      logEntries.some(
        (e) =>
          (e as Record<string, unknown>).event === "error" &&
          (e as Record<string, unknown>).context === "spawnOutlierAnalysis",
      ),
    );
  },
);

Deno.test(
  "advancePhase: non-implementation/running with dead PID does not call spawnOutlierAnalysis",
  async () => {
    const ticket = makeTicket({ phase: "enrichment", status: "running" });
    const spawnOutlierAnalysisSpy = spy(() => Promise.resolve());
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        spawnOutlierAnalysis: spawnOutlierAnalysisSpy,
      }),
    );
    assertSpyCalls(spawnOutlierAnalysisSpy, 0);
  },
);

Deno.test(
  "advancePhase: implementation/running with dead PID and no spawnOutlierAnalysis dep does not throw",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "running",
      prs: [{ url: "u", title: "T", dependsOn: [], merged: false }],
      worktrees: {
        "jackjennings/lazyboy": { path: "/wt/path", branch: "gh-1" },
      },
    });
    const writeTicketSpy = spy((_dir: string, _t: TicketState) =>
      Promise.resolve()
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: writeTicketSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    assertSpyCalls(writeTicketSpy, 1);
  },
);

Deno.test(
  "advancePhase: new ticket includes state prompt in spawned prompt",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${stateDir}/prompts`);
      await Deno.writeTextFile(
        `${stateDir}/prompts/intake.md`,
        "STATE INTAKE CONTEXT",
      );
      const ticket = makeTicket({ phase: "intake", status: "new" });
      let spawnedPrompt = "";
      const spawnSpy = spy((opts: SpawnOpts) => {
        spawnedPrompt = opts.prompt;
        return Promise.resolve();
      });
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          spawn: spawnSpy,
          resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        }),
      );
      assertSpyCall(spawnSpy, 0);
      assertStringIncludes(spawnedPrompt, "STATE INTAKE CONTEXT");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "advancePhase: phase transition includes state prompt in spawned prompt",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${stateDir}/prompts`);
      await Deno.writeTextFile(
        `${stateDir}/prompts/enrichment.md`,
        "STATE ENRICHMENT CONTEXT",
      );
      const ticket = makeTicket({
        phase: "intake",
        status: "waiting",
        approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
      });
      let spawnedPrompt = "";
      const spawnSpy = spy((opts: SpawnOpts) => {
        spawnedPrompt = opts.prompt;
        return Promise.resolve();
      });
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          spawn: spawnSpy,
          resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        }),
      );
      assertSpyCall(spawnSpy, 0);
      assertStringIncludes(spawnedPrompt, "STATE ENRICHMENT CONTEXT");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "advancePhase: revising includes state prompt in spawned prompt",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${stateDir}/prompts`);
      await Deno.writeTextFile(
        `${stateDir}/prompts/implementation.md`,
        "STATE IMPL CONTEXT",
      );
      const ticket = makeTicket({
        phase: "implementation",
        status: "revising",
        worktrees: {
          "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" },
        },
      });
      let spawnedPrompt = "";
      const spawnSpy = spy((opts: SpawnOpts) => {
        spawnedPrompt = opts.prompt;
        return Promise.resolve();
      });
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          spawn: spawnSpy,
          resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        }),
      );
      assertSpyCall(spawnSpy, 0);
      assertStringIncludes(spawnedPrompt, "STATE IMPL CONTEXT");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "advancePhase: empty state prompt file does not inject blank separator",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${stateDir}/prompts`);
      await Deno.writeTextFile(`${stateDir}/prompts/intake.md`, "");
      const ticket = makeTicket({ phase: "intake", status: "new" });
      let spawnedPrompt = "";
      const spawnSpy = spy((opts: SpawnOpts) => {
        spawnedPrompt = opts.prompt;
        return Promise.resolve();
      });
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          spawn: spawnSpy,
          resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        }),
      );
      assertSpyCall(spawnSpy, 0);
      assertFalse(spawnedPrompt.includes("\n\n\n"));
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "advancePhase: state prompt error propagates",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${stateDir}/prompts`);
      await Deno.mkdir(`${stateDir}/prompts/intake.md`);
      const ticket = makeTicket({ phase: "intake", status: "new" });
      await assertRejects(() =>
        advancePhase(
          ticket,
          stateDir,
          makeTickDeps({
            resolveModelConfig: () => ({ model: "m", thinking: "off" }),
            selfReview: () =>
              Promise.resolve({ approved: false, reason: null }),
          }),
        )
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test("TickService: processLearnings called once per run", async () => {
  const processLearningsSpy = spy((): Promise<void> => Promise.resolve());
  const deps = makeTickServiceDeps({ processLearnings: processLearningsSpy });
  await new TickService(deps).run();
  assertSpyCalls(processLearningsSpy, 1);
});

Deno.test(
  "TickService: processLearnings called before ticket processing",
  async () => {
    const sequence: string[] = [];
    const deps = makeTickServiceDeps({
      processLearnings: spy((): Promise<void> => {
        sequence.push("processLearnings");
        return Promise.resolve();
      }),
      listTickets: spy((): Promise<string[]> => {
        sequence.push("listTickets");
        return Promise.resolve([]);
      }),
    });
    await new TickService(deps).run();
    assertLess(
      sequence.indexOf("processLearnings"),
      sequence.indexOf("listTickets"),
    );
  },
);

Deno.test(
  "TickService: proceeds normally when processLearnings is omitted",
  async () => {
    const commitStateSpy = spy((): Promise<void> => Promise.resolve());
    const deps = makeTickServiceDeps({ commitState: commitStateSpy });
    await new TickService(deps).run();
    assertSpyCalls(commitStateSpy, 1);
  },
);

Deno.test(
  "TickService: runCeremonies called after commitState",
  async () => {
    const sequence: string[] = [];
    const deps = makeTickServiceDeps({
      commitState: spy(() => {
        sequence.push("commitState");
        return Promise.resolve();
      }),
      runCeremonies: spy(() => {
        sequence.push("runCeremonies");
        return Promise.resolve();
      }),
    });
    await new TickService(deps).run();
    assertLess(
      sequence.indexOf("commitState"),
      sequence.indexOf("runCeremonies"),
    );
  },
);

Deno.test(
  "TickService: proceeds normally when runCeremonies is absent",
  async () => {
    const deps = makeTickServiceDeps();
    await new TickService(deps).run();
  },
);

Deno.test(
  "TickService: shortTitle set from generateShortTitle when it returns a value",
  async () => {
    const item: WorkItem = {
      id: "gh-3",
      provider: "github",
      title: "Add feature for doing something useful",
      url: "https://github.com/t/r/issues/3",
      description: "body",
    };
    const provider: Provider = {
      fetchNew: () => Promise.resolve([item]),
      close: () => Promise.resolve(),
    };
    const writtenTickets: TicketState[] = [];
    const deps = makeTickServiceDeps({
      providers: [provider],
      listTickets: () => Promise.resolve([]),
      writeTicket: spy((t: TicketState) => {
        writtenTickets.push(t);
        return Promise.resolve();
      }),
      generateShortTitle: (_title) => Promise.resolve("Add feature"),
    });
    await new TickService(deps).run();
    assertEquals(writtenTickets[0].shortTitle, "Add feature");
  },
);

Deno.test(
  "TickService: shortTitle is undefined when generateShortTitle returns null",
  async () => {
    const item: WorkItem = {
      id: "gh-3",
      provider: "github",
      title: "Title",
      url: "https://example.com",
      description: "body",
    };
    const provider: Provider = {
      fetchNew: () => Promise.resolve([item]),
      close: () => Promise.resolve(),
    };
    const writtenTickets: TicketState[] = [];
    const deps = makeTickServiceDeps({
      providers: [provider],
      listTickets: () => Promise.resolve([]),
      writeTicket: spy((t: TicketState) => {
        writtenTickets.push(t);
        return Promise.resolve();
      }),
      generateShortTitle: (_title) => Promise.resolve(null),
    });
    await new TickService(deps).run();
    assertEquals(writtenTickets[0].shortTitle, undefined);
  },
);

Deno.test(
  "TickService: shortTitle is absent when generateShortTitle dep is not provided",
  async () => {
    const item: WorkItem = {
      id: "gh-3",
      provider: "github",
      title: "Title",
      url: "https://example.com",
      description: "body",
    };
    const provider: Provider = {
      fetchNew: () => Promise.resolve([item]),
      close: () => Promise.resolve(),
    };
    const writtenTickets: TicketState[] = [];
    const deps = makeTickServiceDeps({
      providers: [provider],
      listTickets: () => Promise.resolve([]),
      writeTicket: spy((t: TicketState) => {
        writtenTickets.push(t);
        return Promise.resolve();
      }),
    });
    await new TickService(deps).run();
    assertEquals(writtenTickets[0].shortTitle, undefined);
  },
);

Deno.test(
  "TickService: scaffoldStatePrompts called before commitState",
  async () => {
    const sequence: string[] = [];
    const deps = makeTickServiceDeps({
      scaffoldStatePrompts: spy(() => {
        sequence.push("scaffoldStatePrompts");
        return Promise.resolve();
      }),
      commitState: spy(() => {
        sequence.push("commitState");
        return Promise.resolve();
      }),
    });
    await new TickService(deps).run();
    assertLess(
      sequence.indexOf("scaffoldStatePrompts"),
      sequence.indexOf("commitState"),
    );
  },
);

Deno.test(
  "TickService: proceeds normally when scaffoldStatePrompts is absent",
  async () => {
    const deps = makeTickServiceDeps();
    await new TickService(deps).run();
  },
);

Deno.test(
  "advancePhase: per-provider prompt content is included in spawned prompt",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(stateDir, "prompts", "github"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(stateDir, "prompts", "github", "intake.md"),
        "github intake supplement",
      );
      const ticket = makeTicket({
        id: "github/jackjennings/testrepo/1",
        provider: "github",
        phase: "intake",
        status: "new",
      });
      let capturedPrompt = "";
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          spawn: (opts) => {
            capturedPrompt = opts.prompt;
            return Promise.resolve();
          },
          resolveModelConfig: () => ({
            model: "claude-sonnet-4-6",
            thinking: "off",
          }),
        }),
      );
      assertEquals(capturedPrompt.includes("github intake supplement"), true);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "advancePhase: notion ticket in implementation/running with no notionPages moves to needs-attention",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      const ticket = makeTicket({
        phase: "implementation",
        status: "running",
        artifact: "notion",
      });
      const statuses: string[] = [];
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          writeTicket: (_dir, t) => {
            statuses.push(t.status);
            return Promise.resolve();
          },
          resolveModelConfig: () => ({
            model: "claude-sonnet-4-6",
            thinking: "off",
          }),
          readPhaseOutput: () => Promise.resolve("output content"),
        }),
      );
      assertArrayIncludes(statuses, ["waiting", "needs-attention"]);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "advancePhase: notion ticket in plan/waiting/approved with no worktrees spawns implementation",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      const ticket = makeTicket({
        phase: "plan",
        status: "waiting",
        artifact: "notion",
        approvals: [{
          timestamp: "2026-01-01T00:00:00Z",
          actor: "human",
          phase: "plan",
        }],
        worktrees: {},
      });
      let spawnedPhase: string | undefined;
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          spawn: (opts) => {
            spawnedPhase = opts.phase;
            return Promise.resolve();
          },
          resolveModelConfig: () => ({
            model: "claude-sonnet-4-6",
            thinking: "off",
          }),
          readPhaseOutput: () => Promise.resolve(null),
        }),
      );
      assertEquals(spawnedPhase, "implementation");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "advancePhase: notion ticket in implementation/waiting/approved transitions to merge/done without calling markPRsReady",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      const ticket = makeTicket({
        phase: "implementation",
        status: "waiting",
        artifact: "notion",
        approvals: [{
          timestamp: "2026-01-01T00:00:00Z",
          actor: "human",
          phase: "implementation",
        }],
      });
      let writtenPhase: string | undefined;
      let writtenStatus: string | undefined;
      const markPRsReadySpy = spy(() => Promise.resolve());
      await advancePhase(
        ticket,
        stateDir,
        makeTickDeps({
          writeTicket: (_dir, t) => {
            writtenPhase = t.phase;
            writtenStatus = t.status;
            return Promise.resolve();
          },
          resolveModelConfig: () => ({
            model: "claude-sonnet-4-6",
            thinking: "off",
          }),
          markPRsReady: markPRsReadySpy,
          readPhaseOutput: () => Promise.resolve(null),
        }),
      );
      assertEquals(writtenPhase, "merge");
      assertEquals(writtenStatus, "done");
      assertSpyCalls(markPRsReadySpy, 0);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "TickService: preflightGitHubCredentials called before processLearnings",
  async () => {
    const order: string[] = [];
    const deps = makeTickServiceDeps({
      preflightGitHubCredentials: () => {
        order.push("preflight");
        return Promise.resolve();
      },
      processLearnings: () => {
        order.push("learnings");
        return Promise.resolve();
      },
    });
    await new TickService(deps).run();
    assert(order.indexOf("preflight") < order.indexOf("learnings"));
  },
);

Deno.test(
  "TickService: emits agents-md-too-large when file token count exceeds threshold",
  async () => {
    const dir = await Deno.makeTempDir();
    const agentsMdPath = join(dir, "AGENTS.md");
    await Deno.writeTextFile(agentsMdPath, "word ".repeat(500));
    const captured: object[] = [];
    const deps = makeTickServiceDeps({
      agentsMdPaths: [agentsMdPath],
      agentsMdMaxTokens: 10,
      listTickets: () => Promise.resolve(["gh-1"]),
      appendTickLog: (entry) => {
        captured.push(entry);
        return Promise.resolve();
      },
    });
    await new TickService(deps).run();
    await Deno.remove(dir, { recursive: true });
    const entry = captured.find(
      (e) => (e as Record<string, unknown>).event === "agents-md-too-large",
    );
    assert(entry !== undefined);
    const e = entry as Record<string, unknown>;
    assertEquals(e.path, agentsMdPath);
    assertEquals(e.maxTokens, 10);
    assert(typeof e.tokens === "number" && (e.tokens as number) > 10);
  },
);

Deno.test(
  "TickService: no agents-md-too-large event when agentsMdPaths is absent",
  async () => {
    const captured: object[] = [];
    const deps = makeTickServiceDeps({
      appendTickLog: (entry) => {
        captured.push(entry);
        return Promise.resolve();
      },
    });
    await new TickService(deps).run();
    assertFalse(
      captured.some(
        (e) => (e as Record<string, unknown>).event === "agents-md-too-large",
      ),
    );
  },
);

Deno.test(
  "advancePhase: emits prompt-too-long for intake path when threshold exceeded",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "new" });
    const appendLogSpy = spy(
      (_dir: string, _id: string, _entry: object) => Promise.resolve(),
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        maxPromptTokens: 1,
      }),
    );
    const entries = appendLogSpy.calls.map(
      (c) => c.args[2] as Record<string, unknown>,
    );
    const warning = entries.find((e) => e.event === "prompt-too-long");
    assert(warning !== undefined, "expected prompt-too-long event");
    assertEquals(warning.event, "prompt-too-long");
    assertEquals(warning.phase, "intake");
    assertEquals(warning.maxTokens, 1);
    assertLess(0, warning.tokens as number);
  },
);

Deno.test(
  "TickService: no agents-md-too-large event when file token count is within threshold",
  async () => {
    const dir = await Deno.makeTempDir();
    const agentsMdPath = join(dir, "AGENTS.md");
    await Deno.writeTextFile(agentsMdPath, "hi");
    const captured: object[] = [];
    const deps = makeTickServiceDeps({
      agentsMdPaths: [agentsMdPath],
      agentsMdMaxTokens: 100000,
      listTickets: () => Promise.resolve(["gh-1"]),
      appendTickLog: (entry) => {
        captured.push(entry);
        return Promise.resolve();
      },
    });
    await new TickService(deps).run();
    await Deno.remove(dir, { recursive: true });
    assertFalse(
      captured.some(
        (e) => (e as Record<string, unknown>).event === "agents-md-too-large",
      ),
    );
  },
);

Deno.test(
  "TickService: missing AGENTS.md is skipped silently and tick completes",
  async () => {
    const commitStateSpy = spy((): Promise<void> => Promise.resolve());
    const deps = makeTickServiceDeps({
      agentsMdPaths: ["/nonexistent/path/AGENTS.md"],
      agentsMdMaxTokens: 10,
      listTickets: () => Promise.resolve(["gh-1"]),
      commitState: commitStateSpy,
    });
    await new TickService(deps).run();
    assertSpyCalls(commitStateSpy, 1);
  },
);

Deno.test(
  "TickService: emits one agents-md-too-large event per exceeding file",
  async () => {
    const dir = await Deno.makeTempDir();
    const path1 = join(dir, "root1", "AGENTS.md");
    const path2 = join(dir, "root2", "AGENTS.md");
    await Deno.mkdir(join(dir, "root1"), { recursive: true });
    await Deno.mkdir(join(dir, "root2"), { recursive: true });
    await Deno.writeTextFile(path1, "word ".repeat(500));
    await Deno.writeTextFile(path2, "word ".repeat(500));
    const captured: object[] = [];
    const deps = makeTickServiceDeps({
      agentsMdPaths: [path1, path2],
      agentsMdMaxTokens: 10,
      listTickets: () => Promise.resolve(["gh-1"]),
      appendTickLog: (entry) => {
        captured.push(entry);
        return Promise.resolve();
      },
    });
    await new TickService(deps).run();
    await Deno.remove(dir, { recursive: true });
    const events = captured.filter(
      (e) => (e as Record<string, unknown>).event === "agents-md-too-large",
    );
    assertEquals(events.length, 2);
    const paths = events.map((e) => (e as Record<string, unknown>).path);
    assertArrayIncludes(paths, [path1, path2]);
  },
);

Deno.test(
  "advancePhase: emits prompt-too-long for revising path when threshold exceeded",
  async () => {
    const ticket = makeTicket({ phase: "enrichment", status: "revising" });
    const appendLogSpy = spy(
      (_dir: string, _id: string, _entry: object) => Promise.resolve(),
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        maxPromptTokens: 1,
      }),
    );
    const entries = appendLogSpy.calls.map(
      (c) => c.args[2] as Record<string, unknown>,
    );
    const warning = entries.find((e) => e.event === "prompt-too-long");
    assert(warning !== undefined, "expected prompt-too-long event");
    assertEquals(warning.phase, "enrichment");
    assertEquals(warning.maxTokens, 1);
    assertLess(0, warning.tokens as number);
  },
);

Deno.test(
  "TickService: agents-md-too-large fires on each phase start while over threshold",
  async () => {
    const dir = await Deno.makeTempDir();
    const agentsMdPath = join(dir, "AGENTS.md");
    await Deno.writeTextFile(agentsMdPath, "word ".repeat(500));
    const captured: object[] = [];
    const appendTickLog = (entry: object) => {
      captured.push(entry);
      return Promise.resolve();
    };
    const deps = makeTickServiceDeps({
      agentsMdPaths: [agentsMdPath],
      agentsMdMaxTokens: 10,
      listTickets: () => Promise.resolve(["gh-1"]),
      appendTickLog,
    });
    await new TickService(deps).run();
    await new TickService(deps).run();
    await Deno.remove(dir, { recursive: true });
    const events = captured.filter(
      (e) => (e as Record<string, unknown>).event === "agents-md-too-large",
    );
    assertEquals(events.length, 2);
  },
);

Deno.test(
  "advancePhase: spec/waiting + approved + phases.plan.skip skips plan, advances to implementation",
  async () => {
    const ticket = makeTicket({
      phase: "spec",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "spec" }],
      phases: { plan: { skip: true } },
      worktrees: {
        "jackjennings/lazyboy": { path: "/tmp/wt", branch: "gh-1" },
      },
    });
    let spawnedPhase = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPhase = opts.phase;
      return Promise.resolve();
    });
    const logEntries: object[] = [];
    const appendLogSpy = spy(
      (_dir: string, _id: string, entry: object) => {
        logEntries.push(entry);
        return Promise.resolve();
      },
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        readPhaseExitCode: () => Promise.resolve(null),
      }),
    );
    assertEquals(spawnedPhase, "implementation");
    assertArrayIncludes(logEntries as Record<string, unknown>[], [
      { event: "phase-transition", from: "spec", to: "implementation" },
    ]);
  },
);

Deno.test(
  "advancePhase: spec/waiting + approved without skipPlan advances to plan",
  async () => {
    const ticket = makeTicket({
      phase: "spec",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "spec" }],
    });
    let spawnedPhase = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPhase = opts.phase;
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        readPhaseExitCode: () => Promise.resolve(null),
      }),
    );
    assertEquals(spawnedPhase, "plan");
  },
);

Deno.test(
  "advancePhase: emits prompt-too-long for waiting+approved path when threshold exceeded",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "waiting",
      approvals: [{
        timestamp: "2026-08-06T00:00:00Z",
        actor: "human",
        phase: "intake",
      }],
    });
    const appendLogSpy = spy(
      (_dir: string, _id: string, _entry: object) => Promise.resolve(),
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        maxPromptTokens: 1,
      }),
    );
    const entries = appendLogSpy.calls.map(
      (c) => c.args[2] as Record<string, unknown>,
    );
    const warning = entries.find((e) => e.event === "prompt-too-long");
    assert(warning !== undefined, "expected prompt-too-long event");
    assertEquals(warning.phase, "enrichment");
    assertEquals(warning.maxTokens, 1);
    assertLess(0, warning.tokens as number);
  },
);

Deno.test(
  "advancePhase: no prompt-too-long when prompt is within threshold",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "new" });
    const appendLogSpy = spy(
      (_dir: string, _id: string, _entry: object) => Promise.resolve(),
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
        maxPromptTokens: 100_000,
      }),
    );
    const entries = appendLogSpy.calls.map(
      (c) => c.args[2] as Record<string, unknown>,
    );
    assertFalse(entries.some((e) => e.event === "prompt-too-long"));
  },
);

Deno.test(
  "advancePhase: no prompt-too-long with default threshold for real prompts",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "new" });
    const appendLogSpy = spy(
      (_dir: string, _id: string, _entry: object) => Promise.resolve(),
    );
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        appendLog: appendLogSpy,
        resolveModelConfig: () => ({
          model: "claude-sonnet-4-6",
          thinking: "off",
        }),
      }),
    );
    const entries = appendLogSpy.calls.map(
      (c) => c.args[2] as Record<string, unknown>,
    );
    assertFalse(entries.some((e) => e.event === "prompt-too-long"));
  },
);

Deno.test(
  "advancePhase: adjudicatePhaseModel called with prompt when next is implementation",
  async () => {
    const ticket = makeTicket({
      phase: "plan",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "plan" }],
      worktrees: { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "b" } },
    });
    let capturedPrompt: string | undefined;
    const adjudicatePhaseModelSpy = spy((p: string) => {
      capturedPrompt = p;
      return Promise.resolve(null);
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        adjudicatePhaseModel: adjudicatePhaseModelSpy,
      }),
    );
    assertSpyCalls(adjudicatePhaseModelSpy, 1);
    assertExists(capturedPrompt);
  },
);

Deno.test(
  "advancePhase: non-null adjudicatePhaseModel result is merged into ticket before resolveModelConfig",
  async () => {
    const ticket = makeTicket({
      phase: "plan",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "plan" }],
      worktrees: { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "b" } },
    });
    const adjudicatedModel = { model: "claude-opus-4-6", thinking: "max" };
    let resolveModelConfigTicket: TicketState | undefined;
    const writtenTickets: TicketState[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        writeTicket: (_dir, t) => {
          writtenTickets.push(t);
          return Promise.resolve();
        },
        resolveModelConfig: (_phase, t) => {
          resolveModelConfigTicket = t;
          return { model: "claude-sonnet-4-6", thinking: "off" };
        },
        adjudicatePhaseModel: () => Promise.resolve(adjudicatedModel),
      }),
    );
    assertEquals(
      resolveModelConfigTicket?.phases?.["implementation"],
      adjudicatedModel,
    );
    const overrideWrite = writtenTickets.find(
      (t) =>
        t.phases?.["implementation"] !== undefined && t.status !== "running",
    );
    assertExists(overrideWrite);
  },
);

Deno.test(
  "advancePhase: null adjudicatePhaseModel result leaves ticket unchanged for resolveModelConfig",
  async () => {
    const ticket = makeTicket({
      phase: "plan",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "plan" }],
      worktrees: { "jackjennings/lazyboy": { path: "/tmp/wt", branch: "b" } },
    });
    let resolveModelConfigTicket: TicketState | undefined;
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        resolveModelConfig: (_phase, t) => {
          resolveModelConfigTicket = t;
          return { model: "claude-sonnet-4-6", thinking: "off" };
        },
        adjudicatePhaseModel: () => Promise.resolve(null),
      }),
    );
    assertEquals(
      resolveModelConfigTicket?.phases?.["implementation"],
      undefined,
    );
  },
);

Deno.test(
  "advancePhase: adjudicatePhaseModel not called for non-implementation next phase",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
    });
    const adjudicatePhaseModelSpy = spy(() => Promise.resolve(null));
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        adjudicatePhaseModel: adjudicatePhaseModelSpy,
      }),
    );
    assertSpyCalls(adjudicatePhaseModelSpy, 0);
  },
);

type MockCommandOutput = {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
};
type MockCommandFactory = (
  _cmd: string,
  _opts?: Deno.CommandOptions,
) => { output: () => Promise<MockCommandOutput> };
type DenoWithMockCommand = Omit<typeof Deno, "Command"> & {
  Command: MockCommandFactory;
};

function stubDenoCommand(factory: MockCommandFactory) {
  return stub(
    Deno as unknown as DenoWithMockCommand,
    "Command",
    factory,
  );
}

Deno.test(
  "adjudicatePhaseModel: valid response returns parsed model and thinking",
  async () => {
    const encoder = new TextEncoder();
    const commandStub = stubDenoCommand(() => ({
      output: () =>
        Promise.resolve({
          code: 0,
          stdout: encoder.encode(
            JSON.stringify({
              structured_output: { model: "claude-opus-4-6", thinking: "high" },
            }),
          ),
          stderr: new Uint8Array(),
        }),
    }));
    try {
      const result = await adjudicatePhaseModel("implement something");
      assertEquals(result, { model: "claude-opus-4-6", thinking: "high" });
    } finally {
      commandStub.restore();
    }
  },
);

Deno.test(
  "adjudicatePhaseModel: invalid model id returns null",
  async () => {
    const encoder = new TextEncoder();
    const commandStub = stubDenoCommand(() => ({
      output: () =>
        Promise.resolve({
          code: 0,
          stdout: encoder.encode(
            JSON.stringify({
              structured_output: { model: "gpt-4", thinking: "high" },
            }),
          ),
          stderr: new Uint8Array(),
        }),
    }));
    try {
      const result = await adjudicatePhaseModel("p");
      assertEquals(result, null);
    } finally {
      commandStub.restore();
    }
  },
);

Deno.test(
  "adjudicatePhaseModel: haiku model id returns null",
  async () => {
    const encoder = new TextEncoder();
    const commandStub = stubDenoCommand(() => ({
      output: () =>
        Promise.resolve({
          code: 0,
          stdout: encoder.encode(
            JSON.stringify({
              structured_output: { model: "claude-haiku-4-5", thinking: "off" },
            }),
          ),
          stderr: new Uint8Array(),
        }),
    }));
    try {
      const result = await adjudicatePhaseModel("p");
      assertEquals(result, null);
    } finally {
      commandStub.restore();
    }
  },
);

Deno.test(
  "adjudicatePhaseModel: invalid thinking level returns null",
  async () => {
    const encoder = new TextEncoder();
    const commandStub = stubDenoCommand(() => ({
      output: () =>
        Promise.resolve({
          code: 0,
          stdout: encoder.encode(
            JSON.stringify({
              structured_output: {
                model: "claude-sonnet-4-6",
                thinking: "turbo",
              },
            }),
          ),
          stderr: new Uint8Array(),
        }),
    }));
    try {
      const result = await adjudicatePhaseModel("p");
      assertEquals(result, null);
    } finally {
      commandStub.restore();
    }
  },
);

Deno.test(
  "adjudicatePhaseModel: non-zero exit code returns null",
  async () => {
    const commandStub = stubDenoCommand(() => ({
      output: () =>
        Promise.resolve({
          code: 1,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        }),
    }));
    try {
      const result = await adjudicatePhaseModel("p");
      assertEquals(result, null);
    } finally {
      commandStub.restore();
    }
  },
);

Deno.test(
  "adjudicatePhaseModel: malformed JSON in stdout returns null",
  async () => {
    const encoder = new TextEncoder();
    const commandStub = stubDenoCommand(() => ({
      output: () =>
        Promise.resolve({
          code: 0,
          stdout: encoder.encode("not json"),
          stderr: new Uint8Array(),
        }),
    }));
    try {
      const result = await adjudicatePhaseModel("p");
      assertEquals(result, null);
    } finally {
      commandStub.restore();
    }
  },
);

Deno.test(
  "adjudicatePhaseModel: command throws returns null",
  async () => {
    const commandStub = stubDenoCommand(() => ({
      output: () => {
        throw new Error("command failed");
      },
    }));
    try {
      const result = await adjudicatePhaseModel("p");
      assertEquals(result, null);
    } finally {
      commandStub.restore();
    }
  },
);

Deno.test("plan.md does not contain model recommendation instructions", async () => {
  const content = await Deno.readTextFile(
    new URL("./phases/prompts/plan.md", import.meta.url).pathname,
  );
  assertFalse(content.includes("## Model recommendation"));
});

Deno.test(
  "advancePhase: spec revising uses revision prompt when spec-revision.md exists",
  async () => {
    const ticket = makeTicket({
      phase: "spec",
      status: "revising",
      provider: "jira",
    });
    let spawnedPrompt = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPrompt = opts.prompt;
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    const revisionPrompt = await Deno.readTextFile(
      new URL("./phases/prompts/spec-revision.md", import.meta.url).pathname,
    );
    assertStringIncludes(spawnedPrompt, revisionPrompt.trim());
  },
);

Deno.test(
  "advancePhase: intake revising uses authoring prompt when no revision file exists",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "revising",
      provider: "jira",
    });
    let spawnedPrompt = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPrompt = opts.prompt;
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: spawnSpy,
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    assertSpyCall(spawnSpy, 0);
    const authoringPrompt = await loadPromptFile("intake.md");
    assertStringIncludes(spawnedPrompt, authoringPrompt.trim());
  },
);

Deno.test(
  "advancePhase: notion ticket at implementation/running with no notionPages → needs-attention with reason no-pages",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "running",
      artifact: "notion",
    });
    const written: TicketState[] = [];
    const logEntries: object[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        writeTicket: (_dir, t) => {
          written.push(t);
          return Promise.resolve();
        },
        appendLog: (_dir, _id, entry) => {
          logEntries.push(entry);
          return Promise.resolve();
        },
        readPhaseOutput: () => Promise.resolve("valid output"),
      }),
    );
    const last = written.at(-1)!;
    assertEquals(last.status, "needs-attention");
    assertArrayIncludes(logEntries as Record<string, unknown>[], [{
      event: "phase-transition",
      from: "implementation",
      to: "needs-attention",
      reason: "no-pages",
    }]);
  },
);

Deno.test(
  "advancePhase: notion ticket at implementation/waiting approved with notionPages → merge/done",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "waiting",
      artifact: "notion",
      approvals: [{ timestamp: "t", actor: "human", phase: "implementation" }],
      notionPages: [{ url: "https://notion.so/page", title: "Doc" }],
    });
    const written: TicketState[] = [];
    const markPRsReadySpy = spy((_urls: string[]) => Promise.resolve());
    const writeTicketSpy = spy((_dir: string, t: TicketState) => {
      written.push(t);
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        writeTicket: writeTicketSpy,
        markPRsReady: markPRsReadySpy,
      }),
    );
    assertSpyCall(writeTicketSpy, 0);
    assertEquals(written[0].phase, "merge");
    assertEquals(written[0].status, "done");
    assertSpyCalls(markPRsReadySpy, 0);
  },
);

Deno.test(
  "advancePhase: notion ticket at plan/waiting approved with no worktrees proceeds to implementation",
  async () => {
    const ticket = makeTicket({
      phase: "plan",
      status: "waiting",
      artifact: "notion",
      approvals: [{ timestamp: "t", actor: "human", phase: "plan" }],
      worktrees: {},
    });
    let spawnedPhase = "";
    const spawnSpy = spy((opts: SpawnOpts) => {
      spawnedPhase = opts.phase;
      return Promise.resolve();
    });
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        ...makeTickDeps(),
        spawn: spawnSpy,
      }),
    );
    assertSpyCall(spawnSpy, 0);
    assertEquals(spawnedPhase, "implementation");
  },
);

Deno.test("CLAUDE.md reason vocabulary includes no-pages", async () => {
  const content = await Deno.readTextFile(
    new URL("../CLAUDE.md", import.meta.url).pathname,
  );
  assertStringIncludes(content, "no-pages");
});

Deno.test(
  "advancePhase: revising prompt is unchanged when no comment-context file exists",
  async () => {
    const ticket = makeTicket({ phase: "plan", status: "revising" });
    const spawnedPrompts: string[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: (opts) => {
          spawnedPrompts.push(opts.prompt);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    assertFalse(spawnedPrompts[0].includes("comment-context"));
  },
);

Deno.test(
  "advancePhase: revising prompt includes most recent comment-context file content",
  async () => {
    const stateDir = await Deno.makeTempDir();
    const ticketDir = join(stateDir, "github", "org", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260101T120000-comment-context.md"),
      "## New comments\n\nOlder comment",
    );
    await Deno.writeTextFile(
      join(ticketDir, "20260201T080000-comment-context.md"),
      "## New comments\n\nNewer comment",
    );
    const ticket = makeTicket({
      id: "github/org/repo/1",
      phase: "plan",
      status: "revising",
    });
    const spawnedPrompts: string[] = [];
    await advancePhase(
      ticket,
      stateDir,
      makeTickDeps({
        spawn: (opts) => {
          spawnedPrompts.push(opts.prompt);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    assertStringIncludes(spawnedPrompts[0], "Newer comment");
    assertFalse(spawnedPrompts[0].includes("Older comment"));
    await Deno.remove(stateDir, { recursive: true });
  },
);

Deno.test(
  "advancePhase: new ticket stores session ID in phaseSessionIds before spawning",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "new" });
    let writtenTicket: TicketState | undefined;
    let spawnOpts: SpawnOpts | undefined;
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: (opts) => {
          spawnOpts = opts;
          return Promise.resolve();
        },
        writeTicket: (_dir, t) => {
          writtenTicket = t;
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    const uuid = writtenTicket?.phaseSessionIds?.["intake"];
    assertExists(uuid);
    assert(/^[0-9a-f-]{36}$/.test(uuid));
    assertExists(spawnOpts);
    assertEquals(spawnOpts!.sessionId, uuid);
  },
);

Deno.test(
  "advancePhase: waiting + approved stores session ID in phaseSessionIds before spawning next phase",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "waiting",
      approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
    });
    let writtenTicket: TicketState | undefined;
    let spawnOpts: SpawnOpts | undefined;
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: (opts) => {
          spawnOpts = opts;
          return Promise.resolve();
        },
        writeTicket: (_dir, t) => {
          writtenTicket = t;
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
      }),
    );
    const uuid = writtenTicket?.phaseSessionIds?.["enrichment"];
    assertExists(uuid);
    assert(/^[0-9a-f-]{36}$/.test(uuid));
    assertExists(spawnOpts);
    assertEquals(spawnOpts!.sessionId, uuid);
  },
);

Deno.test(
  "advancePhase: boot ID mismatch with stored session ID resumes the phase",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "running",
      phaseSessionIds: { intake: "uuid-stored" },
    });
    const writtenStatuses: string[] = [];
    const loggedEvents: string[] = [];
    let spawnOpts: SpawnOpts | undefined;
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        spawn: (opts) => {
          spawnOpts = opts;
          return Promise.resolve();
        },
        writeTicket: (_dir, t) => {
          writtenStatuses.push(t.status);
          return Promise.resolve();
        },
        appendLog: (_dir, _id, entry) => {
          loggedEvents.push((entry as { event: string }).event);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        readPhaseOutput: () => Promise.resolve(null),
        readPhaseExitCode: () => Promise.resolve(null),
        readRunPidBootStamp: () => Promise.resolve("old-boot"),
        currentBootId: () => "new-boot",
      }),
    );
    assert(writtenStatuses.includes("running"));
    assert(loggedEvents.includes("phase-resumed"));
    assertExists(spawnOpts);
    assertEquals(spawnOpts!.sessionId, "uuid-stored");
    assertEquals(spawnOpts!.resume, true);
  },
);

Deno.test(
  "advancePhase: matching boot IDs with null exit code goes to needs-attention",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "running",
      phaseSessionIds: { intake: "uuid-stored" },
    });
    const writtenStatuses: string[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenStatuses.push(t.status);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        readPhaseOutput: () => Promise.resolve(null),
        readPhaseExitCode: () => Promise.resolve(null),
        readRunPidBootStamp: () => Promise.resolve("same-boot"),
        currentBootId: () => "same-boot",
      }),
    );
    assert(writtenStatuses.includes("needs-attention"));
    assertFalse(writtenStatuses.includes("running"));
  },
);

Deno.test(
  "advancePhase: boot ID mismatch without stored session ID goes to needs-attention",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "running" });
    const writtenStatuses: string[] = [];
    await advancePhase(
      ticket,
      "/state",
      makeTickDeps({
        writeTicket: (_dir, t) => {
          writtenStatuses.push(t.status);
          return Promise.resolve();
        },
        resolveModelConfig: () => ({ model: "m", thinking: "off" }),
        readPhaseOutput: () => Promise.resolve(null),
        readPhaseExitCode: () => Promise.resolve(null),
        readRunPidBootStamp: () => Promise.resolve("old-boot"),
        currentBootId: () => "new-boot",
      }),
    );
    assert(writtenStatuses.includes("needs-attention"));
    assertFalse(writtenStatuses.includes("running"));
  },
);
