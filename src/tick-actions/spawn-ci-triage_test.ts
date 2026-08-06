import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { spawnCITriageAction } from "./spawn-ci-triage.ts";
import type { CIRunResult, SpawnCITriageDeps } from "./spawn-ci-triage.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "github/jackjennings/lazyboy/178",
    provider: "github",
    title: "T",
    url: "https://github.com/jackjennings/lazyboy/issues/178",
    phase: "implementation",
    status: "waiting",
    approvals: [],
    scope: [],
    worktrees: {
      "jackjennings/lazyboy": {
        path: "/wt/lazyboy",
        branch: "github/jackjennings/lazyboy/178",
      },
    },
    prs: [
      {
        url: "https://github.com/jackjennings/lazyboy/pull/99",
        title: "feat",
        dependsOn: [],
        merged: false,
        worktreeKey: "jackjennings/lazyboy",
      },
    ],
    created: "2026-07-27T00:00:00Z",
    updated: "2026-07-27T00:00:00Z",
    body: "",
    artifact: "pr",
    ...overrides,
  };
}

const FAILURE_RESULT: CIRunResult = {
  runId: "run-1",
  conclusion: "failure",
  failingOutput: "FAILED tick_test.ts > foo",
};

function makeDeps(
  overrides: Partial<SpawnCITriageDeps> = {},
): SpawnCITriageDeps {
  return {
    getPRChecks: () => Promise.resolve(null),
    getPRDiffFiles: () => Promise.resolve([]),
    isProcessAlive: () => false,
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    spawn: () => Promise.resolve(),
    writeContextFile: () => Promise.resolve("context.md"),
    resolveModelConfig: () => ({
      model: "claude-sonnet-4-6",
      thinking: "high",
    }),
    ...overrides,
  };
}

// ── applies ───────────────────────────────────────────────────────────────────

Deno.test("spawnCITriageAction: applies when ticket has unmerged PR", () => {
  const action = spawnCITriageAction(makeDeps());
  assert(action.applies(makeTicket()));
});

Deno.test(
  "spawnCITriageAction: does not apply when all PRs merged",
  () => {
    const action = spawnCITriageAction(makeDeps());
    assertFalse(
      action.applies(
        makeTicket({
          prs: [{ url: "u", title: "T", dependsOn: [], merged: true }],
        }),
      ),
    );
  },
);

Deno.test("spawnCITriageAction: does not apply when prs is undefined", () => {
  const action = spawnCITriageAction(makeDeps());
  assertFalse(action.applies(makeTicket({ prs: undefined })));
});

Deno.test(
  "spawnCITriageAction: does not apply when status is needs-attention",
  () => {
    const action = spawnCITriageAction(makeDeps());
    assertFalse(
      action.applies(makeTicket({ status: "needs-attention" })),
    );
  },
);

Deno.test("spawnCITriageAction: does not apply when process is alive", () => {
  const action = spawnCITriageAction(
    makeDeps({ isProcessAlive: () => true }),
  );
  assertFalse(action.applies(makeTicket()));
});

// ── no failure → null ─────────────────────────────────────────────────────────

Deno.test("spawnCITriageAction: no CI result → returns null", async () => {
  const result = await spawnCITriageAction(makeDeps()).run(
    makeTicket(),
    "/state",
  );
  assertEquals(result, null);
});

Deno.test(
  "spawnCITriageAction: closed PR (getPRChecks returns null) → no spawn",
  async () => {
    const spawnSpy = spy(() => Promise.resolve());
    const result = await spawnCITriageAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(null),
        spawn: spawnSpy,
      }),
    ).run(makeTicket(), "/state");
    assertEquals(result, null);
    assertSpyCalls(spawnSpy, 0);
  },
);

Deno.test(
  "spawnCITriageAction: CI success conclusion → returns null, no spawn",
  async () => {
    let spawnCalled = false;
    const result = await spawnCITriageAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r1",
            conclusion: "success",
            failingOutput: "",
          }),
        spawn: () => {
          spawnCalled = true;
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(result, null);
    assertFalse(spawnCalled);
  },
);

// ── run ID deduplication ──────────────────────────────────────────────────────

Deno.test(
  "spawnCITriageAction: run ID already in ciHandledRunIds → skips, returns null",
  async () => {
    const spawnSpy = spy(() => Promise.resolve());
    const result = await spawnCITriageAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FAILURE_RESULT),
        spawn: spawnSpy,
      }),
    ).run(
      makeTicket({ ciHandledRunIds: ["run-1"] }),
      "/state",
    );
    assertEquals(result, null);
    assertSpyCalls(spawnSpy, 0);
  },
);

// ── failure → triage spawn ────────────────────────────────────────────────────

Deno.test(
  "spawnCITriageAction: failure → writeContextFile + spawn, runId handled",
  async () => {
    let spawnCalled = false;
    const result = await spawnCITriageAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FAILURE_RESULT),
        spawn: () => {
          spawnCalled = true;
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assert(spawnCalled);
    assert(result?.ciHandledRunIds?.includes("run-1"));
  },
);

Deno.test(
  "spawnCITriageAction: action_required conclusion → spawn",
  async () => {
    let spawnCalled = false;
    await spawnCITriageAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r2",
            conclusion: "action_required",
            failingOutput: "waiting on approval",
          }),
        spawn: () => {
          spawnCalled = true;
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assert(spawnCalled);
  },
);

Deno.test(
  "spawnCITriageAction: spawn failure → handledIds rolled back, no ticket written",
  async () => {
    const written: unknown[] = [];
    const result = await spawnCITriageAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FAILURE_RESULT),
        spawn: () => Promise.reject(new Error("spawn failed")),
        writeTicket: (_sd, t) => {
          written.push(t);
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(result, null);
    assertEquals(written.length, 0);
  },
);

Deno.test(
  "spawnCITriageAction: writeContextFile failure → handledIds rolled back, no spawn",
  async () => {
    let spawnCalled = false;
    const result = await spawnCITriageAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FAILURE_RESULT),
        writeContextFile: () => Promise.reject(new Error("disk full")),
        spawn: () => {
          spawnCalled = true;
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(result, null);
    assertFalse(spawnCalled);
  },
);

Deno.test(
  "spawnCITriageAction: getPRDiffFiles throws → handledIds rolled back, logs error",
  async () => {
    const logged: object[] = [];
    let spawnCalled = false;
    const result = await spawnCITriageAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FAILURE_RESULT),
        getPRDiffFiles: () => Promise.reject(new Error("rate limit")),
        spawn: () => {
          spawnCalled = true;
          return Promise.resolve();
        },
        appendLog: (_sd, _id, entry) => {
          logged.push(entry);
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(result, null);
    assertFalse(spawnCalled);
    assertEquals((logged[0] as Record<string, string>).event, "error");
  },
);

Deno.test(
  "spawnCITriageAction: spawn receives model and thinking from resolveModelConfig",
  async () => {
    const spawnOpts: Record<string, unknown>[] = [];
    await spawnCITriageAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FAILURE_RESULT),
        resolveModelConfig: () => ({
          model: "claude-haiku-4-5",
          thinking: "off",
        }),
        spawn: (opts) => {
          spawnOpts.push(opts as Record<string, unknown>);
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(spawnOpts.length, 1);
    assertEquals(spawnOpts[0].model, "claude-haiku-4-5");
    assertEquals(spawnOpts[0].thinking, "off");
  },
);

Deno.test(
  "spawnCITriageAction: context file content includes CI output and diff patch",
  async () => {
    const written: { runId: string; content: string }[] = [];
    await spawnCITriageAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r9",
            conclusion: "failure",
            failingOutput: "TS2345: argument not assignable",
          }),
        getPRDiffFiles: () =>
          Promise.resolve([{ filename: "src/foo.ts", patch: "-old\n+new" }]),
        writeContextFile: (_dir, runId, content) => {
          written.push({ runId, content });
          return Promise.resolve("ctx.md");
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(written.length, 1);
    assertStringIncludes(written[0].content, "TS2345");
    assertStringIncludes(written[0].content, "src/foo.ts");
    assertStringIncludes(written[0].content, "-old\n+new");
  },
);

// ── error handling ────────────────────────────────────────────────────────────

Deno.test(
  "spawnCITriageAction: getPRChecks throws → logs error, returns null",
  async () => {
    const logged: object[] = [];
    const result = await spawnCITriageAction(
      makeDeps({
        getPRChecks: () => Promise.reject(new Error("rate limit")),
        appendLog: (_sd, _id, entry) => {
          logged.push(entry);
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(result, null);
    assertEquals(
      (logged[0] as Record<string, string>).event,
      "error",
    );
  },
);

// ── writeTicket ───────────────────────────────────────────────────────────────

Deno.test(
  "spawnCITriageAction: handled runId persisted to ciHandledRunIds on writeTicket",
  async () => {
    const written: TicketState[] = [];
    await spawnCITriageAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FAILURE_RESULT),
        writeTicket: (_sd, t) => {
          written.push(t);
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(written.length, 1);
    assert(written[0].ciHandledRunIds?.includes("run-1"));
  },
);

Deno.test(
  "spawnCITriageAction: existing ciHandledRunIds preserved when new runId added",
  async () => {
    const written: TicketState[] = [];
    await spawnCITriageAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({ ...FAILURE_RESULT, runId: "run-2" }),
        writeTicket: (_sd, t) => {
          written.push(t);
          return Promise.resolve();
        },
      }),
    ).run(makeTicket({ ciHandledRunIds: ["run-1"] }), "/state");
    assert(written[0].ciHandledRunIds?.includes("run-1"));
    assert(written[0].ciHandledRunIds?.includes("run-2"));
  },
);
