import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { resolveCIFailuresAction } from "./resolve-ci-failures.ts";
import type {
  CIRunResult,
  ResolveCIFailuresDeps,
} from "./resolve-ci-failures.ts";
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
    ...overrides,
  };
}

const FMT_RESULT: CIRunResult = {
  runId: "run-1",
  conclusion: "failure",
  firstFailingStep: "fmt",
  failingOutput: "error: src/phases/prompts/implementation.md",
  failingFiles: ["src/phases/prompts/implementation.md"],
};

function makeDeps(
  overrides: Partial<ResolveCIFailuresDeps> = {},
): ResolveCIFailuresDeps {
  return {
    getPRChecks: () => Promise.resolve(null),
    getPRDiffFiles: () => Promise.resolve([]),
    runFmt: () => Promise.resolve(false),
    runLintFix: () => Promise.resolve({ allFixed: true, remainingOutput: "" }),
    runGit: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    createGitHubIssue: () => Promise.resolve(),
    readFile: () => Promise.resolve(null),
    writeFile: () => Promise.resolve(),
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

Deno.test("resolveCIFailuresAction: applies when ticket has unmerged PR", () => {
  const action = resolveCIFailuresAction(makeDeps());
  assertEquals(action.applies(makeTicket()), true);
});

Deno.test(
  "resolveCIFailuresAction: does not apply when all PRs merged",
  () => {
    const action = resolveCIFailuresAction(makeDeps());
    assertEquals(
      action.applies(
        makeTicket({
          prs: [{ url: "u", title: "T", dependsOn: [], merged: true }],
        }),
      ),
      false,
    );
  },
);

Deno.test("resolveCIFailuresAction: does not apply when prs is undefined", () => {
  const action = resolveCIFailuresAction(makeDeps());
  assertEquals(action.applies(makeTicket({ prs: undefined })), false);
});

Deno.test(
  "resolveCIFailuresAction: does not apply when status is needs-attention",
  () => {
    const action = resolveCIFailuresAction(makeDeps());
    assertEquals(
      action.applies(makeTicket({ status: "needs-attention" })),
      false,
    );
  },
);

Deno.test("resolveCIFailuresAction: does not apply when process is alive", () => {
  const action = resolveCIFailuresAction(
    makeDeps({ isProcessAlive: () => true }),
  );
  assertEquals(action.applies(makeTicket()), false);
});

// ── no failure → null ─────────────────────────────────────────────────────────

Deno.test("resolveCIFailuresAction: no CI result → returns null", async () => {
  const result = await resolveCIFailuresAction(makeDeps()).run(
    makeTicket(),
    "/state",
  );
  assertEquals(result, null);
});

Deno.test(
  "resolveCIFailuresAction: CI success conclusion → returns null",
  async () => {
    const result = await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r1",
            conclusion: "success",
            firstFailingStep: "fmt",
            failingOutput: "",
            failingFiles: [],
          }),
      }),
    ).run(makeTicket(), "/state");
    assertEquals(result, null);
  },
);

// ── run ID deduplication ──────────────────────────────────────────────────────

Deno.test(
  "resolveCIFailuresAction: run ID already in ciHandledRunIds → skips, returns null",
  async () => {
    const runGitSpy = spy(() =>
      Promise.resolve({ code: 0, stdout: "", stderr: "" })
    );
    const result = await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FMT_RESULT),
        runFmt: () => Promise.resolve(true),
        runGit: runGitSpy,
      }),
    ).run(
      makeTicket({ ciHandledRunIds: ["run-1"] }),
      "/state",
    );
    assertEquals(result, null);
    assertSpyCalls(runGitSpy, 0);
  },
);

// ── PR-caused fmt fix ─────────────────────────────────────────────────────────

Deno.test(
  "resolveCIFailuresAction: PR-caused fmt failure → runFmt called, commit + push",
  async () => {
    const gitCalls: string[][] = [];
    const result = await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FMT_RESULT),
        runFmt: () => Promise.resolve(true),
        runGit: (args) => {
          gitCalls.push(args);
          return Promise.resolve({ code: 0, stdout: "", stderr: "" });
        },
        readFile: () => Promise.resolve("5. Run `deno fmt && deno lint`."),
      }),
    ).run(makeTicket(), "/state");
    const hasCommit = gitCalls.some(
      (a) => a[0] === "commit" && a.includes("fix: run deno fmt"),
    );
    const hasPush = gitCalls.some((a) => a[0] === "push");
    assertEquals(hasCommit, true);
    assertEquals(hasPush, true);
    assertEquals(result?.ciHandledRunIds?.includes("run-1"), true);
  },
);

Deno.test(
  "resolveCIFailuresAction: runFmt produces no changes → no commit",
  async () => {
    const gitCalls: string[][] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FMT_RESULT),
        runFmt: () => Promise.resolve(false),
        runGit: (args) => {
          gitCalls.push(args);
          return Promise.resolve({ code: 0, stdout: "", stderr: "" });
        },
        readFile: () => Promise.resolve("5. Run `deno fmt && deno lint`."),
      }),
    ).run(makeTicket(), "/state");
    const hasCommit = gitCalls.some((a) => a[0] === "commit");
    assertEquals(hasCommit, false);
  },
);

Deno.test(
  "resolveCIFailuresAction: no worktreeKey on PR → createGitHubIssue called instead of runFmt",
  async () => {
    const issues: string[] = [];
    const ticket = makeTicket({
      prs: [
        {
          url: "https://github.com/jackjennings/lazyboy/pull/99",
          title: "feat",
          dependsOn: [],
          merged: false,
        },
      ],
    });
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FMT_RESULT),
        createGitHubIssue: (opts) => {
          issues.push(opts.title);
          return Promise.resolve();
        },
      }),
    ).run(ticket, "/state");
    assertEquals(issues.length, 1);
  },
);

// ── PR-caused lint fix ────────────────────────────────────────────────────────

Deno.test(
  "resolveCIFailuresAction: PR-caused lint failure fully fixed → commit + push",
  async () => {
    const gitCalls: string[][] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r2",
            conclusion: "failure",
            firstFailingStep: "lint",
            failingOutput: "error in src/tick.ts",
            failingFiles: ["src/tick.ts"],
          }),
        runLintFix: () =>
          Promise.resolve({ allFixed: true, remainingOutput: "" }),
        runGit: (args) => {
          gitCalls.push(args);
          return Promise.resolve({ code: 0, stdout: "", stderr: "" });
        },
      }),
    ).run(makeTicket(), "/state");
    const hasCommit = gitCalls.some(
      (a) => a[0] === "commit" && a.includes("fix: run deno lint --fix"),
    );
    assertEquals(hasCommit, true);
  },
);

Deno.test(
  "resolveCIFailuresAction: PR-caused lint failure partially fixed → createGitHubIssue",
  async () => {
    const issues: string[] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r3",
            conclusion: "failure",
            firstFailingStep: "lint",
            failingOutput: "error: no-explicit-any",
            failingFiles: ["src/tick.ts"],
          }),
        runLintFix: () =>
          Promise.resolve({
            allFixed: false,
            remainingOutput: "error: no-explicit-any",
          }),
        createGitHubIssue: (opts) => {
          issues.push(opts.title);
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(issues.length, 1);
  },
);

// ── test/other → spawn, not createGitHubIssue ────────────────────────────────

Deno.test(
  "resolveCIFailuresAction: test step → spawn called, createGitHubIssue not called",
  async () => {
    let spawnCalled = false;
    let issueCreated = false;
    const result = await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r4",
            conclusion: "failure",
            firstFailingStep: "test",
            failingOutput: "FAILED tick_test.ts > foo",
            failingFiles: [],
          }),
        getPRDiffFiles: () => Promise.resolve([]),
        spawn: () => {
          spawnCalled = true;
          return Promise.resolve();
        },
        createGitHubIssue: () => {
          issueCreated = true;
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(spawnCalled, true);
    assertEquals(issueCreated, false);
    assertEquals(result?.ciHandledRunIds?.includes("r4"), true);
  },
);

Deno.test(
  "resolveCIFailuresAction: other step → spawn called",
  async () => {
    let spawnCalled = false;
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r5",
            conclusion: "failure",
            firstFailingStep: "other",
            failingOutput: "build error",
            failingFiles: [],
          }),
        getPRDiffFiles: () => Promise.resolve([]),
        spawn: () => {
          spawnCalled = true;
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(spawnCalled, true);
  },
);

Deno.test(
  "resolveCIFailuresAction: spawn failure → handledIds rolled back, no ticket written",
  async () => {
    const written: unknown[] = [];
    const result = await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r6",
            conclusion: "failure",
            firstFailingStep: "test",
            failingOutput: "error",
            failingFiles: [],
          }),
        getPRDiffFiles: () => Promise.resolve([]),
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
  "resolveCIFailuresAction: writeContextFile failure → handledIds rolled back",
  async () => {
    let spawnCalled = false;
    const result = await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r7",
            conclusion: "failure",
            firstFailingStep: "test",
            failingOutput: "error",
            failingFiles: [],
          }),
        getPRDiffFiles: () => Promise.resolve([]),
        writeContextFile: () => Promise.reject(new Error("disk full")),
        spawn: () => {
          spawnCalled = true;
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(result, null);
    assertEquals(spawnCalled, false);
  },
);

Deno.test(
  "resolveCIFailuresAction: fmt step → getPRDiffFiles not called",
  async () => {
    let diffCalled = false;
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FMT_RESULT),
        getPRDiffFiles: () => {
          diffCalled = true;
          return Promise.resolve([]);
        },
        runFmt: () => Promise.resolve(false),
        readFile: () => Promise.resolve("5. Run `deno fmt && deno lint`."),
      }),
    ).run(makeTicket(), "/state");
    assertEquals(diffCalled, false);
  },
);

Deno.test(
  "resolveCIFailuresAction: spawn receives model and thinking from resolveModelConfig",
  async () => {
    const spawnOpts: Record<string, unknown>[] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r8",
            conclusion: "failure",
            firstFailingStep: "test",
            failingOutput: "error",
            failingFiles: [],
          }),
        getPRDiffFiles: () => Promise.resolve([]),
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
  "resolveCIFailuresAction: context file content includes CI output and diff patch",
  async () => {
    const written: { runId: string; content: string }[] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r9",
            conclusion: "failure",
            firstFailingStep: "test",
            failingOutput: "TS2345: argument not assignable",
            failingFiles: [],
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
    assertEquals(written[0].content.includes("TS2345"), true);
    assertEquals(written[0].content.includes("src/foo.ts"), true);
    assertEquals(written[0].content.includes("-old\n+new"), true);
  },
);

// ── systemic improvement ──────────────────────────────────────────────────────

Deno.test(
  "resolveCIFailuresAction: fmt fix + lazyboy worktree without step → writes implementation.md and commits",
  async () => {
    const writtenFiles: Array<{ path: string; content: string }> = [];
    const gitCalls: string[][] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FMT_RESULT),
        runFmt: () => Promise.resolve(true),
        runGit: (args) => {
          gitCalls.push(args);
          return Promise.resolve({ code: 0, stdout: "", stderr: "" });
        },
        readFile: () =>
          Promise.resolve(
            "4. Confirm all tests pass\n\nBefore committing",
          ),
        writeFile: (path, content) => {
          writtenFiles.push({ path, content });
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(writtenFiles.length, 1);
    assertEquals(
      writtenFiles[0].path.endsWith("src/phases/prompts/implementation.md"),
      true,
    );
    assertEquals(
      writtenFiles[0].content.includes("deno fmt && deno lint"),
      true,
    );
    const hasDocCommit = gitCalls.some(
      (a) => a[0] === "commit" && a.some((s) => s.includes("implementation")),
    );
    assertEquals(hasDocCommit, true);
  },
);

Deno.test(
  "resolveCIFailuresAction: fmt fix + implementation.md already has step → no extra file write",
  async () => {
    const writtenFiles: string[] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FMT_RESULT),
        runFmt: () => Promise.resolve(true),
        runGit: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        readFile: () =>
          Promise.resolve(
            "5. Run `deno fmt && deno lint`. Required even when only `.md` files",
          ),
        writeFile: (path) => {
          writtenFiles.push(path);
          return Promise.resolve();
        },
      }),
    ).run(makeTicket(), "/state");
    assertEquals(writtenFiles.length, 0);
  },
);

Deno.test(
  "resolveCIFailuresAction: no lazyboy worktree → no systemic improvement attempt",
  async () => {
    const writtenFiles: string[] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FMT_RESULT),
        runFmt: () => Promise.resolve(true),
        runGit: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        writeFile: (path) => {
          writtenFiles.push(path);
          return Promise.resolve();
        },
      }),
    ).run(
      makeTicket({
        worktrees: { "other/repo": { path: "/wt/other", branch: "b" } },
      }),
      "/state",
    );
    assertEquals(writtenFiles.length, 0);
  },
);

// ── error handling ────────────────────────────────────────────────────────────

Deno.test(
  "resolveCIFailuresAction: getPRChecks throws → logs error, returns null",
  async () => {
    const logged: object[] = [];
    const result = await resolveCIFailuresAction(
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

Deno.test(
  "resolveCIFailuresAction: createGitHubIssue throws for no-worktree lint → logs error, does not crash",
  async () => {
    const logged: object[] = [];
    const result = await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () =>
          Promise.resolve({
            runId: "r-err",
            conclusion: "failure",
            firstFailingStep: "lint",
            failingOutput: "error",
            failingFiles: [],
          }),
        createGitHubIssue: () => Promise.reject(new Error("auth")),
        appendLog: (_sd, _id, entry) => {
          logged.push(entry);
          return Promise.resolve();
        },
      }),
    ).run(
      makeTicket({
        prs: [{
          url: "https://github.com/jackjennings/lazyboy/pull/99",
          title: "feat",
          dependsOn: [],
          merged: false,
        }],
      }),
      "/state",
    );
    assertEquals(result, null);
    assertEquals((logged[0] as Record<string, string>).event, "error");
  },
);

// ── writeTicket ───────────────────────────────────────────────────────────────

Deno.test(
  "resolveCIFailuresAction: handled runId persisted to ciHandledRunIds on writeTicket",
  async () => {
    const written: TicketState[] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve(FMT_RESULT),
        runFmt: () => Promise.resolve(false),
        writeTicket: (_sd, t) => {
          written.push(t);
          return Promise.resolve();
        },
        readFile: () => Promise.resolve("5. Run `deno fmt && deno lint`."),
      }),
    ).run(makeTicket(), "/state");
    assertEquals(written.length, 1);
    assertEquals(written[0].ciHandledRunIds?.includes("run-1"), true);
  },
);

Deno.test(
  "resolveCIFailuresAction: existing ciHandledRunIds preserved when new runId added",
  async () => {
    const written: TicketState[] = [];
    await resolveCIFailuresAction(
      makeDeps({
        getPRChecks: () => Promise.resolve({ ...FMT_RESULT, runId: "run-2" }),
        runFmt: () => Promise.resolve(false),
        writeTicket: (_sd, t) => {
          written.push(t);
          return Promise.resolve();
        },
        readFile: () => Promise.resolve("5. Run `deno fmt && deno lint`."),
      }),
    ).run(makeTicket({ ciHandledRunIds: ["run-1"] }), "/state");
    assertEquals(written[0].ciHandledRunIds?.includes("run-1"), true);
    assertEquals(written[0].ciHandledRunIds?.includes("run-2"), true);
  },
);
