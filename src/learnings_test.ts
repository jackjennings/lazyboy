import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import {
  type LearningDeps,
  processLearnings,
  resolveLearningStatus,
} from "./learnings.ts";
import type { LearningState, PrEntry } from "./state/types.ts";

function pr(overrides: Partial<PrEntry> = {}): PrEntry {
  return {
    url: "https://github.com/jackjennings/lazyboy/pull/1",
    title: "t",
    dependsOn: [],
    merged: false,
    ...overrides,
  };
}

function learning(overrides: Partial<LearningState> = {}): LearningState {
  return {
    id: "20260729T050000",
    ticketId: "github/jackjennings/lazyboy/226",
    repo: "jackjennings/lazyboy",
    targetFile: "src/phases/prompts/implementation.md",
    prTitle: "Improve prompt",
    prBody: "Body",
    status: "pending",
    prs: [],
    ...overrides,
  };
}

Deno.test("resolveLearningStatus: waiting when no PRs", () => {
  assertEquals(resolveLearningStatus([]), "waiting");
});

Deno.test("resolveLearningStatus: done when all PRs merged", () => {
  assertEquals(
    resolveLearningStatus([pr({ merged: true }), pr({ merged: true })]),
    "done",
  );
});

Deno.test("resolveLearningStatus: wont-do when all PRs closed unmerged", () => {
  assertEquals(resolveLearningStatus([pr({ closed: true })]), "wont-do");
});

Deno.test("resolveLearningStatus: wont-do when resolved as a mix of merged and closed", () => {
  assertEquals(
    resolveLearningStatus([pr({ merged: true }), pr({ closed: true })]),
    "wont-do",
  );
});

Deno.test("resolveLearningStatus: waiting while any PR is still open", () => {
  assertEquals(
    resolveLearningStatus([pr({ merged: true }), pr()]),
    "waiting",
  );
});

function makeDeps(
  entries: Array<{ learning: LearningState; intent: string }>,
  overrides: Partial<LearningDeps> = {},
): {
  deps: LearningDeps;
  written: Array<{ learning: LearningState; intent: string }>;
} {
  const written: Array<{ learning: LearningState; intent: string }> = [];
  const deps: LearningDeps = {
    listLearnings: () => Promise.resolve(entries),
    writeLearning: (l, i) => {
      written.push({ learning: l, intent: i });
      return Promise.resolve();
    },
    prState: () => Promise.resolve("open"),
    applyToRepo: () =>
      Promise.resolve("https://github.com/jackjennings/lazyboy/pull/9"),
    ...overrides,
  };
  return { deps, written };
}

Deno.test("processLearnings: applies a pending learning and marks it waiting", async () => {
  const applyToRepo = spy((_l: LearningState, _i: string) =>
    Promise.resolve("https://github.com/jackjennings/lazyboy/pull/9")
  );
  const { deps, written } = makeDeps(
    [{ learning: learning(), intent: "Enumerate call sites." }],
    { applyToRepo },
  );
  await processLearnings(deps);
  assertSpyCalls(applyToRepo, 1);
  assertEquals(written.length, 1);
  assertEquals(written[0].learning.status, "waiting");
  assertEquals(written[0].learning.prs.length, 1);
  assertEquals(
    written[0].learning.prs[0].url,
    "https://github.com/jackjennings/lazyboy/pull/9",
  );
});

Deno.test("processLearnings: defers a second pending learning targeting the same file", async () => {
  const applyToRepo = spy((_l: LearningState, _i: string) =>
    Promise.resolve("https://github.com/jackjennings/lazyboy/pull/9")
  );
  const { deps, written } = makeDeps([
    { learning: learning({ id: "a" }), intent: "one" },
    { learning: learning({ id: "b" }), intent: "two" },
  ], { applyToRepo });
  await processLearnings(deps);
  assertSpyCalls(applyToRepo, 1);
  assertEquals(written.length, 1);
  assertEquals(written[0].learning.status, "waiting");
});

Deno.test("processLearnings: marks a learning done when its PR merged", async () => {
  const { deps, written } = makeDeps([{
    learning: learning({ status: "waiting", prs: [pr()] }),
    intent: "x",
  }], { prState: () => Promise.resolve("merged") });
  await processLearnings(deps);
  assertEquals(written.length, 1);
  assertEquals(written[0].learning.status, "done");
  assertEquals(written[0].learning.prs[0].merged, true);
});

Deno.test("processLearnings: marks a learning wont-do when its PR is closed unmerged", async () => {
  const { deps, written } = makeDeps([{
    learning: learning({ status: "waiting", prs: [pr()] }),
    intent: "x",
  }], { prState: () => Promise.resolve("closed") });
  await processLearnings(deps);
  assertEquals(written.length, 1);
  assertEquals(written[0].learning.status, "wont-do");
  assertEquals(written[0].learning.prs[0].closed, true);
});

Deno.test("processLearnings: marks a learning needs-attention when apply throws", async () => {
  const { deps, written } = makeDeps(
    [{ learning: learning(), intent: "x" }],
    { applyToRepo: () => Promise.reject(new Error("no local repo")) },
  );
  await processLearnings(deps);
  assertEquals(written.length, 1);
  assertEquals(written[0].learning.status, "needs-attention");
});

Deno.test("processLearnings: applies a pending learning once the same-file PR has merged this run", async () => {
  const applyToRepo = spy((_l: LearningState, _i: string) =>
    Promise.resolve("https://github.com/jackjennings/lazyboy/pull/9")
  );
  const { deps } = makeDeps([
    {
      learning: learning({ id: "a", status: "waiting", prs: [pr()] }),
      intent: "one",
    },
    { learning: learning({ id: "b", status: "pending" }), intent: "two" },
  ], { prState: () => Promise.resolve("merged"), applyToRepo });
  await processLearnings(deps);
  assertSpyCalls(applyToRepo, 1);
});
