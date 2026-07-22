import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { createWorktreeAction } from "./create-worktree.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "github/myorg/myrepo/1",
    provider: "github",
    title: "T",
    url: "https://github.com/myorg/myrepo/issues/1",
    phase: "intake",
    status: "waiting",
    approved: true,
    scope: [],
    worktrees: {},
    created: "2026-06-23T00:00:00Z",
    updated: "2026-06-23T00:00:00Z",
    body: "",
    ...overrides,
  };
}

function makeAction(
  overrides: Partial<Parameters<typeof createWorktreeAction>[0]> = {},
) {
  return createWorktreeAction({
    roots: ["/code"],
    findLocalRepo: () => Promise.resolve("/code/myorg/myrepo"),
    createWorktree: (_repo, _id, slug) =>
      Promise.resolve({ path: `/wt/${slug}`, branch: "gh-1" }),
    writeTicket: () => Promise.resolve(),
    readIntakeOutput: () => Promise.resolve(null),
    cloneRemoteRepo: () => Promise.reject(new Error("no clone")),
    stat: () => Promise.resolve(false),
    ...overrides,
  });
}

// ── applies ──────────────────────────────────────────────────────────────────

Deno.test(
  "createWorktreeAction: applies to intake/waiting/approved ticket with no worktrees",
  () => {
    assertEquals(
      makeAction().applies(makeTicket()),
      true,
    );
  },
);

Deno.test("createWorktreeAction: does not apply when status is new", () => {
  assertEquals(
    makeAction().applies(makeTicket({ status: "new", approved: false })),
    false,
  );
});

Deno.test("createWorktreeAction: does not apply when not approved", () => {
  assertEquals(
    makeAction().applies(makeTicket({ approved: false })),
    false,
  );
});

Deno.test(
  "createWorktreeAction: does not apply when worktrees already present",
  () => {
    assertEquals(
      makeAction().applies(
        makeTicket({
          worktrees: { "myorg/myrepo": { path: "/wt", branch: "b" } },
        }),
      ),
      false,
    );
  },
);

Deno.test(
  "createWorktreeAction: does not apply when phase is not intake",
  () => {
    assertEquals(
      makeAction().applies(
        makeTicket({ phase: "enrichment", status: "waiting", approved: true }),
      ),
      false,
    );
  },
);

// ── run: GitHub ticket ───────────────────────────────────────────────────────

Deno.test(
  "createWorktreeAction: GitHub ticket, no intake output → uses URL slug, finds locally",
  async () => {
    const written: TicketState[] = [];
    const result = await makeAction({
      findLocalRepo: () => Promise.resolve("/code/myorg/myrepo"),
      writeTicket: (_dir, t) => {
        written.push(t);
        return Promise.resolve();
      },
    }).run(makeTicket(), "/state");

    assertEquals(result?.worktrees, {
      "myorg/myrepo": { path: "/wt/myorg/myrepo", branch: "gh-1" },
    });
    assertEquals(result?.scope, []);
    assertEquals(result?.status, "waiting");
    assertEquals(result?.approved, true);
    assertEquals(written.length, 1);
    assertEquals(written[0].worktrees["myorg/myrepo"].path, "/wt/myorg/myrepo");
  },
);

Deno.test(
  "createWorktreeAction: GitHub ticket, local not found → clones remote",
  async () => {
    const cloneSpy = spy((_slug: string) =>
      Promise.resolve("/clones/myorg/myrepo")
    );
    const createWorktreeSpy = spy(
      (_repo: string, _id: string, slug: string) =>
        Promise.resolve({ path: `/wt/${slug}`, branch: "gh-1" }),
    );
    const result = await makeAction({
      findLocalRepo: () => Promise.resolve(null),
      cloneRemoteRepo: cloneSpy,
      createWorktree: createWorktreeSpy,
    }).run(makeTicket(), "/state");

    assertSpyCalls(cloneSpy, 1);
    assertEquals(cloneSpy.calls[0].args[0], "myorg/myrepo");
    assertEquals(result?.worktrees["myorg/myrepo"].path, "/wt/myorg/myrepo");
  },
);

Deno.test(
  "createWorktreeAction: GitHub ticket, clone fails → needs-attention",
  async () => {
    const written: TicketState[] = [];
    const result = await makeAction({
      findLocalRepo: () => Promise.resolve(null),
      cloneRemoteRepo: () => Promise.reject(new Error("clone failed")),
      writeTicket: (_dir, t) => {
        written.push(t);
        return Promise.resolve();
      },
    }).run(makeTicket(), "/state");

    assertEquals(result?.status, "needs-attention");
    assertEquals(written[0].status, "needs-attention");
  },
);

Deno.test(
  "createWorktreeAction: GitHub ticket, intake adds extra GitHub repo → two worktrees",
  async () => {
    const intakeContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - other/repo\n```\n\n## Reasoning\n\nText.\n";
    const createdSlugs: string[] = [];
    const result = await makeAction({
      readIntakeOutput: () => Promise.resolve(intakeContent),
      findLocalRepo: (_, slug) => Promise.resolve(`/code/${slug}`),
      createWorktree: (_repo, _id, slug) => {
        createdSlugs.push(slug);
        return Promise.resolve({ path: `/wt/${slug}`, branch: "gh-1" });
      },
    }).run(makeTicket(), "/state");

    assertEquals(createdSlugs.sort(), ["myorg/myrepo", "other/repo"]);
    assertEquals(Object.keys(result?.worktrees ?? {}).sort(), [
      "myorg/myrepo",
      "other/repo",
    ]);
  },
);

Deno.test(
  "createWorktreeAction: GitHub ticket, same slug in URL and intake → resolved once",
  async () => {
    const intakeContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - myorg/myrepo\n```\n\n## Reasoning\n\nText.\n";
    const createdSlugs: string[] = [];
    await makeAction({
      readIntakeOutput: () => Promise.resolve(intakeContent),
      findLocalRepo: () => Promise.resolve("/code/myorg/myrepo"),
      createWorktree: (_repo, _id, slug) => {
        createdSlugs.push(slug);
        return Promise.resolve({ path: `/wt/${slug}`, branch: "gh-1" });
      },
    }).run(makeTicket(), "/state");

    assertEquals(createdSlugs, ["myorg/myrepo"]);
  },
);

Deno.test(
  "createWorktreeAction: GitHub ticket, intake has GitHub URL → resolved as slug",
  async () => {
    const intakeContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - https://github.com/other/repo/issues/5\n```\n\n## Reasoning\n\nText.\n";
    const createdSlugs: string[] = [];
    await makeAction({
      readIntakeOutput: () => Promise.resolve(intakeContent),
      findLocalRepo: (_, slug) => Promise.resolve(`/code/${slug}`),
      createWorktree: (_repo, _id, slug) => {
        createdSlugs.push(slug);
        return Promise.resolve({ path: `/wt/${slug}`, branch: "gh-1" });
      },
    }).run(makeTicket(), "/state");

    assertEquals(createdSlugs.sort(), ["myorg/myrepo", "other/repo"]);
  },
);

Deno.test(
  "createWorktreeAction: intake local path exists → added to ticket.scope, no worktree",
  async () => {
    const intakeContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - /usr/local/myproject\n```\n\n## Reasoning\n\nText.\n";
    const createdSlugs: string[] = [];
    const result = await makeAction({
      readIntakeOutput: () => Promise.resolve(intakeContent),
      stat: (p) => Promise.resolve(p === "/usr/local/myproject"),
      createWorktree: (_repo, _id, slug) => {
        createdSlugs.push(slug);
        return Promise.resolve({ path: `/wt/${slug}`, branch: "gh-1" });
      },
    }).run(makeTicket(), "/state");

    assertEquals(result?.scope, ["/usr/local/myproject"]);
    assertEquals(createdSlugs, ["myorg/myrepo"]);
  },
);

Deno.test(
  "createWorktreeAction: intake local path does not exist → omitted from scope",
  async () => {
    const intakeContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - /does/not/exist\n```\n\n## Reasoning\n\nText.\n";
    const result = await makeAction({
      readIntakeOutput: () => Promise.resolve(intakeContent),
      stat: () => Promise.resolve(false),
    }).run(makeTicket(), "/state");

    assertEquals(result?.scope, []);
    assertEquals(result?.status, "waiting");
  },
);

Deno.test(
  "createWorktreeAction: createWorktree throws for one repo → needs-attention, no partial write",
  async () => {
    const intakeContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - other/repo\n```\n\n## Reasoning\n\nText.\n";
    const written: TicketState[] = [];
    const callCount = { n: 0 };
    const result = await makeAction({
      readIntakeOutput: () => Promise.resolve(intakeContent),
      findLocalRepo: (_, slug) => Promise.resolve(`/code/${slug}`),
      createWorktree: (_repo, _id, _slug) => {
        callCount.n++;
        if (callCount.n === 2) throw new Error("worktree add failed");
        return Promise.resolve({ path: `/wt/myorg/myrepo`, branch: "gh-1" });
      },
      writeTicket: (_dir, t) => {
        written.push(t);
        return Promise.resolve();
      },
    }).run(makeTicket(), "/state");

    assertEquals(result?.status, "needs-attention");
    assertEquals(written[0].worktrees, {});
  },
);

// ── run: Jira ticket ─────────────────────────────────────────────────────────

Deno.test(
  "createWorktreeAction: Jira ticket, GitHub slug in intake → creates worktree",
  async () => {
    const intakeContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - org/repo\n```\n\n## Reasoning\n\nText.\n";
    const result = await makeAction({
      readIntakeOutput: () => Promise.resolve(intakeContent),
      findLocalRepo: () => Promise.resolve("/code/org/repo"),
      createWorktree: (_repo, _id, slug) =>
        Promise.resolve({ path: `/wt/${slug}`, branch: "jira-1" }),
    }).run(
      makeTicket({
        id: "jira/PROJ-1",
        provider: "jira",
        url: "https://myco.atlassian.net/browse/PROJ-1",
      }),
      "/state",
    );

    assertEquals(result?.worktrees, {
      "org/repo": { path: "/wt/org/repo", branch: "jira-1" },
    });
    assertEquals(result?.status, "waiting");
  },
);

Deno.test(
  "createWorktreeAction: Jira ticket, no GitHub repos in intake → needs-attention",
  async () => {
    const written: TicketState[] = [];
    const result = await makeAction({
      readIntakeOutput: () => Promise.resolve(null),
      writeTicket: (_dir, t) => {
        written.push(t);
        return Promise.resolve();
      },
    }).run(
      makeTicket({
        id: "jira/PROJ-1",
        provider: "jira",
        url: "https://myco.atlassian.net/browse/PROJ-1",
      }),
      "/state",
    );

    assertEquals(result?.status, "needs-attention");
    assertEquals(written[0].status, "needs-attention");
  },
);

Deno.test(
  "createWorktreeAction: Jira ticket, only local paths in intake → needs-attention",
  async () => {
    const intakeContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - /local/path\n```\n\n## Reasoning\n\nText.\n";
    const result = await makeAction({
      readIntakeOutput: () => Promise.resolve(intakeContent),
      stat: () => Promise.resolve(true),
    }).run(
      makeTicket({
        id: "jira/PROJ-1",
        provider: "jira",
        url: "https://myco.atlassian.net/browse/PROJ-1",
      }),
      "/state",
    );

    assertEquals(result?.status, "needs-attention");
  },
);
