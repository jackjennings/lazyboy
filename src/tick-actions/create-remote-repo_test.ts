import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { createRemoteRepoAction } from "./create-remote-repo.ts";
import type { TicketState } from "../state/types.ts";
import { makeTicket } from "../test-support.ts";

const BASE = {
  id: "github/myorg/myrepo/1",
  url: "https://github.com/myorg/myrepo/issues/1",
  phase: "plan" as const,
  status: "waiting" as const,
  approvals: [{
    timestamp: "2026-06-23T00:00:00Z",
    actor: "human" as const,
    phase: "plan" as const,
  }],
  newRepos: ["myorg/new-repo"],
  worktrees: {
    "myorg/new-repo": {
      path: "/wt/myorg/new-repo",
      branch: "github/myorg/myrepo/1",
    },
  },
  created: "2026-06-23T00:00:00Z",
  updated: "2026-06-23T00:00:00Z",
};

function makeAction(
  overrides: Partial<Parameters<typeof createRemoteRepoAction>[0]> = {},
) {
  return createRemoteRepoAction({
    createRepo: () => Promise.resolve("https://github.com/myorg/new-repo"),
    isPhaseAlive: () => false,
    writeTicket: () => Promise.resolve(),
    appendLog: () => Promise.resolve(),
    runGit: (_args, _cwd) =>
      Promise.resolve({
        code: 0,
        stdout: "/repos/myorg/new-repo/.git",
        stderr: "",
      }),
    ...overrides,
  });
}

// ── applies ──────────────────────────────────────────────────────────────────

Deno.test(
  "createRemoteRepoAction: applies to plan/waiting/approved ticket with newRepos",
  () => {
    assertEquals(makeAction().applies(makeTicket(BASE)), true);
  },
);

Deno.test(
  "createRemoteRepoAction: does not apply when phase is not plan",
  () => {
    assertEquals(
      makeAction().applies(
        makeTicket({ ...BASE, phase: "implementation", status: "waiting" }),
      ),
      false,
    );
  },
);

Deno.test(
  "createRemoteRepoAction: does not apply when status is not waiting",
  () => {
    assertEquals(
      makeAction().applies(makeTicket({ ...BASE, status: "running" })),
      false,
    );
  },
);

Deno.test(
  "createRemoteRepoAction: does not apply when not approved",
  () => {
    assertEquals(
      makeAction().applies(makeTicket({ ...BASE, approvals: [] })),
      false,
    );
  },
);

Deno.test(
  "createRemoteRepoAction: does not apply when newRepos is empty",
  () => {
    assertEquals(
      makeAction().applies(makeTicket({ ...BASE, newRepos: [] })),
      false,
    );
  },
);

Deno.test(
  "createRemoteRepoAction: does not apply when newRepos is absent",
  () => {
    assertEquals(
      makeAction().applies(makeTicket({ ...BASE, newRepos: undefined })),
      false,
    );
  },
);

Deno.test(
  "createRemoteRepoAction: does not apply when phase agent is live",
  () => {
    assertEquals(
      makeAction({ isPhaseAlive: () => true }).applies(makeTicket(BASE)),
      false,
    );
  },
);

// ── run ──────────────────────────────────────────────────────────────────────

Deno.test(
  "createRemoteRepoAction: calls createRepo and runs git remote add and push",
  async () => {
    const createRepoSpy = spy((_slug: string) =>
      Promise.resolve("https://github.com/myorg/new-repo")
    );
    const gitCalls: Array<{ args: string[]; cwd: string }> = [];
    const written: TicketState[] = [];

    const result = await makeAction({
      createRepo: createRepoSpy,
      runGit: (args, cwd) => {
        gitCalls.push({ args, cwd });
        if (args[0] === "rev-parse") {
          return Promise.resolve({
            code: 0,
            stdout: "/repos/myorg/new-repo/.git",
            stderr: "",
          });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      writeTicket: (_dir, t) => {
        written.push(t);
        return Promise.resolve();
      },
    }).run(makeTicket(BASE), "/state");

    assertSpyCalls(createRepoSpy, 1);
    assertEquals(createRepoSpy.calls[0].args[0], "myorg/new-repo");
    const remoteAdd = gitCalls.find((c) => c.args[1] === "add");
    assertEquals(remoteAdd?.args, [
      "remote",
      "add",
      "origin",
      "https://github.com/myorg/new-repo",
    ]);
    const push = gitCalls.find((c) => c.args[0] === "push");
    assertEquals(push?.args, ["push", "origin", "main"]);
    assertEquals(result?.newRepos, undefined);
    assertEquals(written[0].newRepos, undefined);
  },
);

Deno.test(
  "createRemoteRepoAction: createRepo failure → needs-attention with repo-creation-failed",
  async () => {
    const logged: object[] = [];
    const result = await makeAction({
      createRepo: () => Promise.reject(new Error("gh repo create failed")),
      appendLog: (_sd, _id, entry) => {
        logged.push(entry);
        return Promise.resolve();
      },
    }).run(makeTicket(BASE), "/state");

    assertEquals(result?.status, "needs-attention");
    assertEquals(
      (logged[0] as Record<string, unknown>).reason,
      "repo-creation-failed",
    );
    assertEquals(
      (logged[0] as Record<string, unknown>).slug,
      "myorg/new-repo",
    );
  },
);

Deno.test(
  "createRemoteRepoAction: clears newRepos from ticket on success",
  async () => {
    const written: TicketState[] = [];
    const result = await makeAction({
      writeTicket: (_dir, t) => {
        written.push(t);
        return Promise.resolve();
      },
    }).run(makeTicket(BASE), "/state");

    assertEquals(result?.newRepos, undefined);
    assertEquals(written.length, 1);
    assertEquals(written[0].newRepos, undefined);
  },
);
