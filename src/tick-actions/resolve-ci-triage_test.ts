import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { resolveCITriageAction } from "./resolve-ci-triage.ts";
import type { ResolveCITriageDeps } from "./resolve-ci-triage.ts";
import type { TicketState } from "../state/types.ts";
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
  created: "2026-07-29T00:00:00Z",
  updated: "2026-07-29T00:00:00Z",
};

const CONTEXT_CONTENT =
  "PR-URL: https://github.com/jackjennings/lazyboy/pull/99\n" +
  "Repo: jackjennings/lazyboy\n" +
  "Run-ID: run-42\n" +
  "Branch: github/jackjennings/lazyboy/178\n" +
  "Worktree-Path: /wt/lazyboy\n\n" +
  "## CI Output\n\nTS2345 error\n\n## PR Diff\n\n### src/foo.ts";

const PR_CAUSED_OUTPUT =
  "The error is in a file touched by the PR.\nVERDICT: PR_CAUSED\n";

const INFRA_OUTPUT = "Network timeout downloading packages.\nVERDICT: INFRA\n";

const PR_CAUSED_WITH_LEARNING_OUTPUT =
  "The type error is in a file changed by this PR.\n" +
  "VERDICT: PR_CAUSED\n" +
  "LEARNING: Validate all imported types resolve before pushing to ensure type errors surface locally rather than in CI.\n";

function makeDeps(
  overrides: Partial<ResolveCITriageDeps> = {},
): ResolveCITriageDeps {
  return {
    isProcessAlive: () => false,
    hasCITriageContextFiles: () => false,
    readDir: async function* () {},
    readFile: () => Promise.resolve(null),
    remove: () => Promise.resolve(),
    createGitHubIssue: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    writeLearning: () => Promise.resolve(),
    ...overrides,
  };
}

function makeAction(
  overrides: Partial<ResolveCITriageDeps> = {},
) {
  return resolveCITriageAction(makeDeps(overrides));
}

// ── applies ──────────────────────────────────────────────────────────────────

Deno.test("resolveCITriageAction: applies when context files exist and pid dead", () => {
  assert(
    makeAction({ hasCITriageContextFiles: () => true }).applies(
      makeTicket(BASE),
    ),
  );
});

Deno.test("resolveCITriageAction: does not apply when process is alive", () => {
  assertFalse(
    makeAction({
      hasCITriageContextFiles: () => true,
      isProcessAlive: () => true,
    }).applies(makeTicket(BASE)),
  );
});

Deno.test("resolveCITriageAction: does not apply when no context files", () => {
  assertFalse(
    makeAction({ hasCITriageContextFiles: () => false }).applies(
      makeTicket(BASE),
    ),
  );
});

// ── no context files in dir → null ───────────────────────────────────────────

Deno.test("resolveCITriageAction: run returns null when no triage context files in dir", async () => {
  const result = await makeAction({
    hasCITriageContextFiles: () => true,
    readDir: async function* () {
      yield { name: "plan.md", isFile: true };
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals(result, null);
});

// ── PR_CAUSED verdict ─────────────────────────────────────────────────────────

Deno.test(
  "resolveCITriageAction: PR_CAUSED verdict → createGitHubIssue with fix title and reasoning in body",
  async () => {
    const issues: Array<{ repo: string; title: string; body: string }> = [];
    const removed: string[] = [];
    const result = await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve(PR_CAUSED_OUTPUT);
      },
      createGitHubIssue: (opts) => {
        issues.push(opts);
        return Promise.resolve();
      },
      remove: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
      writeTicket: () => Promise.resolve(),
    }).run(makeTicket(BASE), "/state");
    assertEquals(issues.length, 1);
    assertEquals(issues[0].repo, "jackjennings/lazyboy");
    assertStringIncludes(issues[0].title, "Fix CI failure");
    assertStringIncludes(issues[0].body, "The error is in a file");
    assertEquals(removed.length, 2);
    assertNotEquals(result, null);
  },
);

// ── INFRA verdict ─────────────────────────────────────────────────────────────

Deno.test(
  "resolveCITriageAction: INFRA verdict → no issue created, files cleaned up",
  async () => {
    const issues: Array<{ repo: string; title: string; body: string }> = [];
    const removed: string[] = [];
    const logged: object[] = [];
    await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve(INFRA_OUTPUT);
      },
      createGitHubIssue: (opts) => {
        issues.push(opts);
        return Promise.resolve();
      },
      appendLog: (_sd, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
      remove: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
      writeTicket: () => Promise.resolve(),
    }).run(makeTicket(BASE), "/state");
    assertEquals(issues.length, 0);
    assertEquals(removed.length, 2);
    const resolved = (logged as Record<string, unknown>[]).find(
      (e) => e.event === "ci-triage-resolved",
    );
    assertEquals(resolved?.verdict, "INFRA");
  },
);

// ── missing output file ───────────────────────────────────────────────────────

Deno.test(
  "resolveCITriageAction: missing output file → logs error, sets needs-attention, deletes context",
  async () => {
    const logged: object[] = [];
    const written: TicketState[] = [];
    const removed: string[] = [];
    const result = await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve(null);
      },
      appendLog: (_sd, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
      writeTicket: (_sd, t) => {
        written.push(t);
        return Promise.resolve();
      },
      remove: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
    }).run(makeTicket(BASE), "/state");
    assertEquals(result?.status, "needs-attention");
    assertEquals(removed.length, 1);
    assertEquals(
      (logged[0] as Record<string, string>).event,
      "error",
    );
  },
);

// ── no verdict line ───────────────────────────────────────────────────────────

Deno.test(
  "resolveCITriageAction: no verdict line → logs error, sets needs-attention",
  async () => {
    const logged: object[] = [];
    const written: TicketState[] = [];
    await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve("I looked at the logs but couldn't decide.");
      },
      appendLog: (_sd, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
      writeTicket: (_sd, t) => {
        written.push(t);
        return Promise.resolve();
      },
      remove: () => Promise.resolve(),
    }).run(makeTicket(BASE), "/state");
    assertEquals(written[0]?.status, "needs-attention");
    assertEquals(
      (logged[0] as Record<string, string>).event,
      "error",
    );
  },
);

// ── files cleaned up after resolution ────────────────────────────────────────

Deno.test(
  "resolveCITriageAction: context and output files deleted after PR_CAUSED resolution",
  async () => {
    const removed: string[] = [];
    await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve(PR_CAUSED_OUTPUT);
      },
      remove: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
      createGitHubIssue: () => Promise.resolve(),
      writeTicket: () => Promise.resolve(),
    }).run(makeTicket(BASE), "/state");
    assert(removed.some((p) => p.includes("-ci-triage-context-")));
    assert(
      removed.some((p) =>
        p.includes("-ci-triage-") && !p.includes("-context-")
      ),
    );
  },
);

// ── ci-triage-resolved log entry ──────────────────────────────────────────────

Deno.test(
  "resolveCITriageAction: logs ci-triage-resolved with verdict after PR_CAUSED",
  async () => {
    const logged: object[] = [];
    await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve(PR_CAUSED_OUTPUT);
      },
      appendLog: (_sd, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
      createGitHubIssue: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      writeTicket: () => Promise.resolve(),
    }).run(makeTicket(BASE), "/state");
    const resolved = (logged as Record<string, unknown>[]).find(
      (e) => e.event === "ci-triage-resolved",
    );
    assertNotEquals(resolved, undefined);
    assertEquals(resolved!.verdict, "PR_CAUSED");
    assertEquals(resolved!.runId, "run-42");
  },
);

// ── learning extraction ───────────────────────────────────────────────────────

Deno.test(
  "resolveCITriageAction: PR_CAUSED with LEARNING line → writeLearning called with correct fields",
  async () => {
    const written: Array<{ learning: object; intent: string }> = [];
    await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve(PR_CAUSED_WITH_LEARNING_OUTPUT);
      },
      writeLearning: (learning, intent) => {
        written.push({ learning, intent });
        return Promise.resolve();
      },
      createGitHubIssue: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      writeTicket: () => Promise.resolve(),
    }).run(makeTicket(), "/state");
    assertEquals(written.length, 1);
    assertEquals(
      written[0].intent,
      "Validate all imported types resolve before pushing to ensure type errors surface locally rather than in CI.",
    );
    assertEquals(
      (written[0].learning as Record<string, unknown>).repo,
      "jackjennings/lazyboy",
    );
    assertEquals(
      (written[0].learning as Record<string, unknown>).targetFile,
      "AGENTS.md",
    );
    assertEquals(
      (written[0].learning as Record<string, unknown>).status,
      "pending",
    );
    assertEquals(
      (written[0].learning as Record<string, unknown>).ticketId,
      "github/jackjennings/lazyboy/178",
    );
  },
);

Deno.test(
  "resolveCITriageAction: INFRA verdict → writeLearning not called",
  async () => {
    const written: object[] = [];
    await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve(INFRA_OUTPUT);
      },
      writeLearning: (learning, intent) => {
        written.push({ learning, intent });
        return Promise.resolve();
      },
      remove: () => Promise.resolve(),
      writeTicket: () => Promise.resolve(),
    }).run(makeTicket(), "/state");
    assertEquals(written.length, 0);
  },
);

Deno.test(
  "resolveCITriageAction: PR_CAUSED without LEARNING line → writeLearning not called",
  async () => {
    const written: object[] = [];
    await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve(PR_CAUSED_OUTPUT);
      },
      writeLearning: (learning, intent) => {
        written.push({ learning, intent });
        return Promise.resolve();
      },
      createGitHubIssue: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      writeTicket: () => Promise.resolve(),
    }).run(makeTicket(), "/state");
    assertEquals(written.length, 0);
  },
);

Deno.test(
  "resolveCITriageAction: writeLearning throws → files cleaned up and action completes normally",
  async () => {
    const removed: string[] = [];
    const logged: object[] = [];
    const result = await makeAction({
      hasCITriageContextFiles: () => true,
      readDir: async function* () {
        yield {
          name: "20260729T184053-ci-triage-context-run-42.md",
          isFile: true,
        };
      },
      readFile: (path) => {
        if (path.includes("-ci-triage-context-")) {
          return Promise.resolve(CONTEXT_CONTENT);
        }
        return Promise.resolve(PR_CAUSED_WITH_LEARNING_OUTPUT);
      },
      writeLearning: () => Promise.reject(new Error("storage error")),
      createGitHubIssue: () => Promise.resolve(),
      remove: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
      appendLog: (_sd, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
      writeTicket: () => Promise.resolve(),
    }).run(makeTicket(), "/state");
    assertEquals(removed.some((p) => p.includes("-ci-triage-context-")), true);
    assertEquals(
      removed.some((p) =>
        p.includes("-ci-triage-") && !p.includes("-context-")
      ),
      true,
    );
    assertEquals(result !== null, true);
  },
);
