import { assert, assertEquals, assertFalse } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { resolveCIFixAction } from "./resolve-ci-fix.ts";
import type { ResolveCIFixDeps } from "./resolve-ci-fix.ts";
import { makeTicket } from "../test-support.ts";

const BASE = {
  id: "github/jackjennings/lazyboy/178",
  url: "https://github.com/jackjennings/lazyboy/issues/178",
  phase: "implementation" as const,
  status: "waiting" as const,
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
  created: "2026-08-12T00:00:00Z",
  updated: "2026-08-12T00:00:00Z",
};

const CONTEXT_FILENAME = "20260812T101500-ci-fix-context-1001-1.md";
const OUTPUT_FILENAME = "20260812T101500-ci-fix-1001-1.md";

const CONTEXT_CONTENT =
  "PR-URL: https://github.com/jackjennings/lazyboy/pull/99\n" +
  "Repo: jackjennings/lazyboy\n" +
  "Run-ID: 1001\n" +
  "Attempt: 1\n" +
  "Branch: github/jackjennings/lazyboy/178\n" +
  "Worktree-Path: /wt/lazyboy\n\n" +
  "## Failing jobs\n\n- lint";

const FIXED_OUTPUT = "Ran deno fmt and committed the result.\nVERDICT: FIXED\n";
const FIXED_WITH_LEARNING_OUTPUT = "Ran deno fmt and committed the result.\n" +
  "VERDICT: FIXED\n" +
  "LEARNING: Run deno fmt after resolving conflicts so formatting drift never reaches CI.\n";
const INFRA_OUTPUT =
  "Package download timed out on the runner.\nVERDICT: INFRA\n";
const UNFIXABLE_OUTPUT =
  "The failure needs a product decision.\nVERDICT: UNFIXABLE\n";

function makeDeps(overrides: Partial<ResolveCIFixDeps> = {}): ResolveCIFixDeps {
  return {
    isProcessAlive: () => false,
    hasCIFixContextFiles: () => false,
    readDir: async function* () {
      yield { name: CONTEXT_FILENAME, isFile: true };
    },
    readFile: (path: string) =>
      Promise.resolve(
        path.endsWith(CONTEXT_FILENAME) ? CONTEXT_CONTENT : FIXED_OUTPUT,
      ),
    remove: () => Promise.resolve(),
    runGit: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    rerunFailedJobs: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    writeLearning: () => Promise.resolve(),
    ...overrides,
  };
}

function makeAction(overrides: Partial<ResolveCIFixDeps> = {}) {
  return resolveCIFixAction(makeDeps(overrides));
}

function outputReader(output: string) {
  return (path: string) =>
    Promise.resolve(path.endsWith(CONTEXT_FILENAME) ? CONTEXT_CONTENT : output);
}

Deno.test("resolveCIFixAction: applies when context files exist and no process is alive", () => {
  assert(
    makeAction({ hasCIFixContextFiles: () => true }).applies(makeTicket(BASE)),
  );
});

Deno.test("resolveCIFixAction: does not apply when a process is alive", () => {
  assertFalse(
    makeAction({ hasCIFixContextFiles: () => true, isProcessAlive: () => true })
      .applies(makeTicket(BASE)),
  );
});

Deno.test("resolveCIFixAction: does not apply without context files", () => {
  assertFalse(
    makeAction({ hasCIFixContextFiles: () => false }).applies(makeTicket(BASE)),
  );
});

Deno.test("resolveCIFixAction: returns null when the directory holds no context files", async () => {
  const result = await makeAction({
    readDir: async function* () {
      yield { name: "plan.md", isFile: true };
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals(result, null);
});

Deno.test("resolveCIFixAction: FIXED force-pushes the branch and logs branch-pushed", async () => {
  const gitSpy = spy(
    (_args: string[], _cwd: string) =>
      Promise.resolve({ code: 0, stdout: "", stderr: "" }),
  );
  const logged: Record<string, unknown>[] = [];
  const result = await makeAction({
    runGit: gitSpy,
    appendLog: (_sd, _id, entry) => {
      logged.push(entry as Record<string, unknown>);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assertSpyCalls(gitSpy, 1);
  assertEquals(gitSpy.calls[0]!.args[0], [
    "push",
    "--force-with-lease",
    "origin",
    "github/jackjennings/lazyboy/178",
  ]);
  assertEquals(gitSpy.calls[0]!.args[1], "/wt/lazyboy");
  assertEquals(logged[0].event, "branch-pushed");
  assertEquals(result?.status, "waiting");
});

Deno.test("resolveCIFixAction: FIXED logs ci-fix-resolved with the verdict and attempt", async () => {
  const logged: Record<string, unknown>[] = [];
  await makeAction({
    appendLog: (_sd, _id, entry) => {
      logged.push(entry as Record<string, unknown>);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  const resolved = logged.find((e) => e.event === "ci-fix-resolved");
  assertEquals(resolved?.verdict, "FIXED");
  assertEquals(resolved?.runId, "1001");
  assertEquals(resolved?.attempt, "1");
});

Deno.test("resolveCIFixAction: FIXED with a push failure parks the ticket", async () => {
  const logged: Record<string, unknown>[] = [];
  const result = await makeAction({
    runGit: () => Promise.resolve({ code: 1, stdout: "", stderr: "rejected" }),
    appendLog: (_sd, _id, entry) => {
      logged.push(entry as Record<string, unknown>);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals(result?.status, "needs-attention");
  assertEquals(logged[0].reason, "push-failed");
});

Deno.test("resolveCIFixAction: FIXED writes the learning when a LEARNING line is present", async () => {
  const learningSpy = spy(() => Promise.resolve());
  await makeAction({
    readFile: outputReader(FIXED_WITH_LEARNING_OUTPUT),
    writeLearning: learningSpy,
  }).run(makeTicket(BASE), "/state");
  assertSpyCalls(learningSpy, 1);
});

Deno.test("resolveCIFixAction: FIXED without a LEARNING line writes no learning", async () => {
  const learningSpy = spy(() => Promise.resolve());
  await makeAction({ writeLearning: learningSpy }).run(
    makeTicket(BASE),
    "/state",
  );
  assertSpyCalls(learningSpy, 0);
});

Deno.test("resolveCIFixAction: INFRA re-runs the failed jobs and does not push", async () => {
  const gitSpy = spy(
    (_args: string[], _cwd: string) =>
      Promise.resolve({ code: 0, stdout: "", stderr: "" }),
  );
  const rerunSpy = spy((_opts: { repo: string; runId: string }) =>
    Promise.resolve()
  );
  const result = await makeAction({
    readFile: outputReader(INFRA_OUTPUT),
    runGit: gitSpy,
    rerunFailedJobs: rerunSpy,
  }).run(makeTicket(BASE), "/state");
  assertSpyCalls(gitSpy, 0);
  assertSpyCalls(rerunSpy, 1);
  assertEquals(rerunSpy.calls[0]!.args[0], {
    repo: "jackjennings/lazyboy",
    runId: "1001",
  });
  assertEquals(result?.status, "waiting");
});

Deno.test("resolveCIFixAction: a failed re-run is logged and does not park the ticket", async () => {
  const logged: Record<string, unknown>[] = [];
  const result = await makeAction({
    readFile: outputReader(INFRA_OUTPUT),
    rerunFailedJobs: () => Promise.reject(new Error("rate limit")),
    appendLog: (_sd, _id, entry) => {
      logged.push(entry as Record<string, unknown>);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals(result?.status, "waiting");
  assertEquals(logged[0].reason, "rerun-failed");
});

Deno.test("resolveCIFixAction: UNFIXABLE parks the ticket", async () => {
  const logged: Record<string, unknown>[] = [];
  const result = await makeAction({
    readFile: outputReader(UNFIXABLE_OUTPUT),
    appendLog: (_sd, _id, entry) => {
      logged.push(entry as Record<string, unknown>);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals(result?.status, "needs-attention");
  assertEquals(logged[0].reason, "ci-unfixable");
});

Deno.test("resolveCIFixAction: a missing output file parks the ticket", async () => {
  const logged: Record<string, unknown>[] = [];
  const result = await makeAction({
    readFile: (path: string) =>
      Promise.resolve(path.endsWith(CONTEXT_FILENAME) ? CONTEXT_CONTENT : null),
    appendLog: (_sd, _id, entry) => {
      logged.push(entry as Record<string, unknown>);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals(result?.status, "needs-attention");
  assertEquals(logged[0].reason, "output-file-missing");
});

Deno.test("resolveCIFixAction: a missing verdict line parks the ticket", async () => {
  const logged: Record<string, unknown>[] = [];
  const result = await makeAction({
    readFile: outputReader("I looked at the logs and gave up.\n"),
    appendLog: (_sd, _id, entry) => {
      logged.push(entry as Record<string, unknown>);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals(result?.status, "needs-attention");
  assertEquals(logged[0].reason, "no-verdict-line");
});

Deno.test("resolveCIFixAction: FIXED with an empty worktree path parks the ticket", async () => {
  const logged: Record<string, unknown>[] = [];
  const result = await makeAction({
    readFile: (path: string) =>
      Promise.resolve(
        path.endsWith(CONTEXT_FILENAME)
          ? CONTEXT_CONTENT.replace(
            "Worktree-Path: /wt/lazyboy",
            "Worktree-Path:",
          )
          : FIXED_OUTPUT,
      ),
    appendLog: (_sd, _id, entry) => {
      logged.push(entry as Record<string, unknown>);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals(result?.status, "needs-attention");
  assertEquals(logged[0].reason, "no-worktrees");
});

Deno.test("resolveCIFixAction: removes the context and output files after a FIXED run", async () => {
  const removed: string[] = [];
  await makeAction({
    remove: (path: string) => {
      removed.push(path);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assert(removed.some((p) => p.endsWith(CONTEXT_FILENAME)));
  assert(removed.some((p) => p.endsWith(OUTPUT_FILENAME)));
});
