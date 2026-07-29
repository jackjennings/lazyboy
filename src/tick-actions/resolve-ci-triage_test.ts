import { assertEquals } from "@std/assert";
import { resolveCITriageAction } from "./resolve-ci-triage.ts";
import type { ResolveCITriageDeps } from "./resolve-ci-triage.ts";
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
    created: "2026-07-29T00:00:00Z",
    updated: "2026-07-29T00:00:00Z",
    body: "",
    ...overrides,
  };
}

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
  assertEquals(
    makeAction({ hasCITriageContextFiles: () => true }).applies(makeTicket()),
    true,
  );
});

Deno.test("resolveCITriageAction: does not apply when process is alive", () => {
  assertEquals(
    makeAction({
      hasCITriageContextFiles: () => true,
      isProcessAlive: () => true,
    }).applies(makeTicket()),
    false,
  );
});

Deno.test("resolveCITriageAction: does not apply when no context files", () => {
  assertEquals(
    makeAction({ hasCITriageContextFiles: () => false }).applies(makeTicket()),
    false,
  );
});

// ── no context files in dir → null ───────────────────────────────────────────

Deno.test("resolveCITriageAction: run returns null when no triage context files in dir", async () => {
  const result = await makeAction({
    hasCITriageContextFiles: () => true,
    readDir: async function* () {
      yield { name: "plan.md", isFile: true };
    },
  }).run(makeTicket(), "/state");
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
    }).run(makeTicket(), "/state");
    assertEquals(issues.length, 1);
    assertEquals(issues[0].repo, "jackjennings/lazyboy");
    assertEquals(issues[0].title.includes("Fix CI failure"), true);
    assertEquals(issues[0].body.includes("The error is in a file"), true);
    assertEquals(removed.length, 2);
    assertEquals(result !== null, true);
  },
);

// ── INFRA verdict ─────────────────────────────────────────────────────────────

Deno.test(
  "resolveCITriageAction: INFRA verdict → createGitHubIssue with infrastructure title",
  async () => {
    const issues: Array<{ repo: string; title: string; body: string }> = [];
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
      remove: () => Promise.resolve(),
      writeTicket: () => Promise.resolve(),
    }).run(makeTicket(), "/state");
    assertEquals(issues.length, 1);
    assertEquals(issues[0].title, "CI infrastructure failure");
    assertEquals(issues[0].body.includes("Network timeout"), true);
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
    }).run(makeTicket(), "/state");
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
    }).run(makeTicket(), "/state");
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
    }).run(makeTicket(), "/state");
    assertEquals(removed.some((p) => p.includes("-ci-triage-context-")), true);
    assertEquals(
      removed.some((p) =>
        p.includes("-ci-triage-") && !p.includes("-context-")
      ),
      true,
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
    }).run(makeTicket(), "/state");
    const resolved = (logged as Record<string, unknown>[]).find(
      (e) => e.event === "ci-triage-resolved",
    );
    assertEquals(resolved !== undefined, true);
    assertEquals(resolved!.verdict, "PR_CAUSED");
    assertEquals(resolved!.runId, "run-42");
  },
);
