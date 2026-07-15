import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { findLatestPhaseOutput } from "./review.ts";

function runIndex(args: string[], env?: Record<string, string>) {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      new URL("./index.ts", import.meta.url).pathname,
      ...args,
    ],
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  });
  return cmd.output();
}

Deno.test("completion zsh: exits 0", async () => {
  const result = await runIndex(["completion", "zsh"]);
  assertEquals(result.code, 0);
});

Deno.test("completion zsh: output begins with #compdef lazyboy", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertEquals(stdout.startsWith("#compdef lazyboy"), true);
});

Deno.test("completion zsh: defines and registers _lazyboy", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertStringIncludes(stdout, "_lazyboy()");
  assertStringIncludes(stdout, "compdef _lazyboy lazyboy");
});

Deno.test("completion zsh: offers all subcommands", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  for (
    const cmd of [
      "tick",
      "approve",
      "status",
      "enable",
      "disable",
      "completion",
      "review",
    ]
  ) {
    assertStringIncludes(stdout, cmd);
  }
});

Deno.test("completion zsh: approve completion calls lazyboy _ids", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertStringIncludes(stdout, "lazyboy _ids 2>/dev/null");
});

Deno.test(
  "completion zsh: completion subcommand completion offers zsh",
  async () => {
    const result = await runIndex(["completion", "zsh"]);
    const stdout = new TextDecoder().decode(result.stdout);
    assertStringIncludes(stdout, "compadd -- zsh");
  },
);

Deno.test(
  "completion zsh: _ids not listed as a completion candidate",
  async () => {
    const result = await runIndex(["completion", "zsh"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const commandsBlock = stdout.match(/commands=\(([\s\S]*?)\)/)?.[1] ?? "";
    assertEquals(commandsBlock.includes("_ids"), false);
  },
);

Deno.test("completion alone: exits 1 with usage on stderr", async () => {
  const result = await runIndex(["completion"]);
  assertEquals(result.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(result.stderr),
    "Usage: lazyboy completion <zsh>",
  );
});

Deno.test(
  "completion bash: exits 1 with unsupported shell on stderr",
  async () => {
    const result = await runIndex(["completion", "bash"]);
    assertEquals(result.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(result.stderr),
      "Unsupported shell: bash",
    );
  },
);

async function makeFakeHome(stateDir: string): Promise<string> {
  const home = await Deno.makeTempDir();
  const configDir = join(home, ".config", "lazyboy");
  await Deno.mkdir(configDir, { recursive: true });
  await Deno.writeTextFile(
    join(configDir, "config.toml"),
    `
[github]
repos = ["jackjennings/lazyboy"]
[state]
dir = "${stateDir}"
[tick]
concurrency = 1
`,
  );
  return home;
}

Deno.test("_ids: prints one ticket ID per line and exits 0", async () => {
  const stateDir = await Deno.makeTempDir();
  await Deno.mkdir(join(stateDir, "gh-1"));
  await Deno.mkdir(join(stateDir, "gh-2"));
  const home = await makeFakeHome(stateDir);
  try {
    const result = await runIndex(["_ids"], { HOME: home });
    assertEquals(result.code, 0);
    const lines = new TextDecoder().decode(result.stdout)
      .trim()
      .split("\n")
      .sort();
    assertEquals(lines, ["gh-1", "gh-2"]);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test(
  "_ids: empty output and exits 0 when state dir does not exist",
  async () => {
    const home = await makeFakeHome("/nonexistent/lazyboy-state-dir");
    try {
      const result = await runIndex(["_ids"], { HOME: home });
      assertEquals(result.code, 0);
      assertEquals(new TextDecoder().decode(result.stdout).trim(), "");
    } finally {
      await Deno.remove(home, { recursive: true });
    }
  },
);

Deno.test("review: exits 1 with usage message when id is missing", async () => {
  const result = await runIndex(["review"]);
  assertEquals(result.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(result.stderr),
    "Usage: lazyboy review <ticket-id>",
  );
});

Deno.test("completion zsh: offers review subcommand", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertStringIncludes(stdout, "review:review the latest phase output");
});

Deno.test("completion zsh: review completion calls lazyboy _ids", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertStringIncludes(stdout, "review)");
  assertStringIncludes(stdout, "lazyboy _ids 2>/dev/null");
});

Deno.test("review: findLatestPhaseOutput returns null when no output files exist", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const result = await findLatestPhaseOutput(tempDir);
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("review: findLatestPhaseOutput returns latest prefixed revision file", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260629T154506-plan.md"),
      "rev1",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T225507-plan.md"),
      "rev2",
    );
    const result = await findLatestPhaseOutput(tempDir);
    assertEquals(result?.phaseName, "plan");
    assertEquals(result?.filename, "20260629T225507-plan.md");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("review: findLatestPhaseOutput returns most advanced phase with output", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260629T154506-intake.md"),
      "intake",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T154506-spec.md"),
      "spec",
    );
    const result = await findLatestPhaseOutput(tempDir);
    assertEquals(result?.phaseName, "spec");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("review: findLatestPhaseOutput excludes feedback files from revision glob", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260629T154506-plan-feedback.md"),
      "fb",
    );
    const result = await findLatestPhaseOutput(tempDir);
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

async function makeTicketHome(
  stateDir: string,
  id: string,
  worktrees: Record<string, { path: string; branch: string }>,
): Promise<string> {
  const home = await makeFakeHome(stateDir);
  const ticketDir = join(stateDir, id);
  await Deno.mkdir(ticketDir, { recursive: true });
  const worktreesYaml = Object.entries(worktrees)
    .map(([slug, w]) =>
      `  ${slug}:\n    path: ${w.path}\n    branch: ${w.branch}`
    )
    .join("\n");
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: ${id}
provider: github
title: Test Ticket
url: https://github.com/jackjennings/lazyboy/issues/1
phase: plan
status: waiting
approved: false
scope: []
created: "2026-06-01T00:00:00Z"
updated: "2026-06-01T00:00:00Z"
worktrees:
${worktreesYaml}
---

body
`,
  );
  return home;
}

Deno.test("shell: exits 1 with usage when id is missing", async () => {
  const result = await runIndex(["shell"]);
  assertEquals(result.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(result.stderr),
    "Usage: lazyboy shell <ticket-id>",
  );
});

Deno.test("shell: exits 1 with OS error when ticket not found", async () => {
  const stateDir = await Deno.makeTempDir();
  const home = await makeFakeHome(stateDir);
  try {
    const result = await runIndex(["shell", "gh-99999"], { HOME: home });
    assertEquals(result.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(result.stderr),
      "gh-99999",
    );
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test(
  "shell: exits 1 with no worktrees message when ticket has no worktrees",
  async () => {
    const stateDir = await Deno.makeTempDir();
    const ticketDir = join(stateDir, "gh-1");
    await Deno.mkdir(ticketDir);
    await Deno.writeTextFile(
      join(ticketDir, "meta.md"),
      `---
id: gh-1
provider: github
title: Test
url: https://github.com/jackjennings/lazyboy/issues/1
phase: intake
status: new
approved: false
scope: []
created: "2026-06-01T00:00:00Z"
updated: "2026-06-01T00:00:00Z"
worktrees: {}
---

body
`,
    );
    const home = await makeFakeHome(stateDir);
    try {
      const result = await runIndex(["shell", "gh-1"], { HOME: home });
      assertEquals(result.code, 1);
      assertStringIncludes(
        new TextDecoder().decode(result.stderr),
        "No worktrees found for gh-1",
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  },
);

Deno.test(
  "shell: exits 1 with path error when worktree path does not exist",
  async () => {
    const stateDir = await Deno.makeTempDir();
    const home = await makeTicketHome(stateDir, "gh-1", {
      "jackjennings/lazyboy": {
        path: "/nonexistent/path/gh-1/jackjennings/lazyboy",
        branch: "gh-1",
      },
    });
    try {
      const result = await runIndex(["shell", "gh-1"], { HOME: home });
      assertEquals(result.code, 1);
      assertStringIncludes(
        new TextDecoder().decode(result.stderr),
        "shell: /nonexistent/path/gh-1/jackjennings/lazyboy: not a directory",
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  },
);

Deno.test(
  "shell: exits 0 when worktree path exists and shell exits 0",
  async () => {
    const stateDir = await Deno.makeTempDir();
    const worktreePath = await Deno.makeTempDir();
    const home = await makeTicketHome(stateDir, "gh-1", {
      "jackjennings/lazyboy": { path: worktreePath, branch: "gh-1" },
    });
    try {
      const result = await runIndex(["shell", "gh-1"], {
        HOME: home,
        SHELL: "/usr/bin/true",
      });
      assertEquals(result.code, 0);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
      await Deno.remove(worktreePath, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  },
);

Deno.test(
  "shell: propagates non-zero exit code from spawned shell",
  async () => {
    const stateDir = await Deno.makeTempDir();
    const worktreePath = await Deno.makeTempDir();
    const home = await makeTicketHome(stateDir, "gh-1", {
      "jackjennings/lazyboy": { path: worktreePath, branch: "gh-1" },
    });
    try {
      const result = await runIndex(["shell", "gh-1"], {
        HOME: home,
        SHELL: "/usr/bin/false",
      });
      assertEquals(result.code, 1);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
      await Deno.remove(worktreePath, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  },
);

Deno.test("status: shows APPROVED column header", async () => {
  const stateDir = await Deno.makeTempDir();
  const home = await makeTicketHome(stateDir, "gh-1", {
    "jackjennings/lazyboy": { path: "/tmp/gh-1", branch: "gh-1" },
  });
  try {
    const result = await runIndex(["status"], { HOME: home });
    assertStringIncludes(
      new TextDecoder().decode(result.stdout),
      "APPROVED",
    );
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test('status: shows "no" for unapproved ticket', async () => {
  const stateDir = await Deno.makeTempDir();
  const home = await makeTicketHome(stateDir, "gh-1", {
    "jackjennings/lazyboy": { path: "/tmp/gh-1", branch: "gh-1" },
  });
  try {
    const result = await runIndex(["status"], { HOME: home });
    assertStringIncludes(
      new TextDecoder().decode(result.stdout),
      "no",
    );
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test('status: shows "yes" for approved ticket', async () => {
  const stateDir = await Deno.makeTempDir();
  const ticketDir = join(stateDir, "gh-2");
  await Deno.mkdir(ticketDir, { recursive: true });
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-2
provider: github
title: Approved Ticket
url: https://github.com/jackjennings/lazyboy/issues/2
phase: plan
status: waiting
approved: true
scope: []
created: "2026-06-01T00:00:00Z"
updated: "2026-06-01T00:00:00Z"
worktrees:
  jackjennings/lazyboy:
    path: /tmp/gh-2
    branch: gh-2
---

body
`,
  );
  const home = await makeFakeHome(stateDir);
  try {
    const result = await runIndex(["status"], { HOME: home });
    assertStringIncludes(
      new TextDecoder().decode(result.stdout),
      "yes",
    );
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("completion zsh: offers shell subcommand", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertStringIncludes(
    stdout,
    "shell:open a shell in the worktree for a ticket",
  );
});

Deno.test("completion zsh: shell completion calls lazyboy _ids", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertStringIncludes(stdout, "shell)");
  assertStringIncludes(stdout, "lazyboy _ids 2>/dev/null");
});

Deno.test(
  "status: rows are sorted by phase order then by ticket ID",
  async () => {
    const stateDir = await Deno.makeTempDir();

    // gh-10 and gh-5 are both in plan; lexicographically "gh-10" < "gh-5"
    // (because '1' < '5'), so gh-10 sorts before gh-5 within the same phase.
    const tickets: Array<{ id: string; phase: string; title: string }> = [
      { id: "gh-10", phase: "plan", title: "Plan Ticket A" },
      { id: "gh-5", phase: "plan", title: "Plan Ticket B" },
      { id: "gh-2", phase: "spec", title: "Spec Ticket" },
    ];

    for (const { id, phase, title } of tickets) {
      const ticketDir = join(stateDir, id);
      await Deno.mkdir(ticketDir, { recursive: true });
      await Deno.writeTextFile(
        join(ticketDir, "meta.md"),
        `---
id: ${id}
provider: github
title: ${title}
url: https://github.com/jackjennings/lazyboy/issues/1
phase: ${phase}
status: waiting
approved: false
scope: []
created: "2026-06-01T00:00:00Z"
updated: "2026-06-01T00:00:00Z"
worktrees: {}
---

body
`,
      );
    }

    const home = await makeFakeHome(stateDir);
    try {
      const result = await runIndex(["status"], { HOME: home });
      assertEquals(result.code, 0);
      const lines = new TextDecoder().decode(result.stdout).trim().split("\n");
      const dataLines = lines.slice(2);
      assertEquals(dataLines.length, 3);
      // spec before plan
      assertEquals(dataLines[0].startsWith("gh-2"), true);
      // within plan: gh-10 before gh-5 (lexicographic: "gh-10" < "gh-5")
      assertEquals(dataLines[1].startsWith("gh-10"), true);
      assertEquals(dataLines[2].startsWith("gh-5"), true);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  },
);

async function gitExec(args: string[], cwd: string): Promise<void> {
  await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

async function makeRepoWithRemote(): Promise<
  { localDir: string; tmpDir: string }
> {
  const tmpDir = await Deno.makeTempDir();
  const upstreamDir = join(tmpDir, "upstream.git");
  const midDir = join(tmpDir, "mid");
  const localDir = join(tmpDir, "local");

  await Deno.mkdir(upstreamDir);
  await gitExec(["init", "--bare"], upstreamDir);
  await gitExec(["clone", upstreamDir, midDir], tmpDir);
  await gitExec(["config", "user.email", "test@test.com"], midDir);
  await gitExec(["config", "user.name", "Test"], midDir);
  await gitExec(["config", "commit.gpgsign", "false"], midDir);
  await Deno.writeTextFile(join(midDir, "README.md"), "init");
  await gitExec(["add", "."], midDir);
  await gitExec(["commit", "-m", "init"], midDir);
  await gitExec(["push"], midDir);
  await gitExec(["clone", upstreamDir, localDir], tmpDir);
  await gitExec(["config", "user.email", "test@test.com"], localDir);
  await gitExec(["config", "user.name", "Test"], localDir);
  await gitExec(["config", "commit.gpgsign", "false"], localDir);

  return { localDir, tmpDir };
}

Deno.test("update: exits 0 when working tree is clean and pull succeeds", async () => {
  const { localDir, tmpDir } = await makeRepoWithRemote();
  try {
    const { runUpdate } = await import("./commands/update.ts");
    const code = await runUpdate(localDir);
    assertEquals(code, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test(
  "update: exits 1 when working tree has local modifications",
  async () => {
    const { localDir, tmpDir } = await makeRepoWithRemote();
    try {
      await Deno.writeTextFile(join(localDir, "dirty.txt"), "change");
      const { runUpdate } = await import("./commands/update.ts");
      const code = await runUpdate(localDir);
      assertEquals(code, 1);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "update: does not run git pull when working tree is dirty",
  async () => {
    const { localDir, tmpDir } = await makeRepoWithRemote();
    try {
      await Deno.writeTextFile(join(localDir, "dirty.txt"), "change");
      const { runUpdate } = await import("./commands/update.ts");
      await runUpdate(localDir);
      const result = await new Deno.Command("git", {
        args: ["log", "--oneline"],
        cwd: localDir,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const log = new TextDecoder().decode(result.stdout).trim().split("\n");
      assertEquals(log.length, 1);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test("update: exits non-zero when pull fails", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await gitExec(["init"], tmpDir);
    await gitExec(["config", "user.email", "test@test.com"], tmpDir);
    await gitExec(["config", "user.name", "Test"], tmpDir);
    await gitExec(["config", "commit.gpgsign", "false"], tmpDir);
    await Deno.writeTextFile(join(tmpDir, "README.md"), "init");
    await gitExec(["add", "."], tmpDir);
    await gitExec(["commit", "-m", "init"], tmpDir);
    await gitExec(
      ["remote", "add", "origin", "file:///nonexistent/repo.git"],
      tmpDir,
    );
    await gitExec(["config", "branch.main.remote", "origin"], tmpDir);
    await gitExec(
      ["config", "branch.main.merge", "refs/heads/main"],
      tmpDir,
    );
    const { runUpdate } = await import("./commands/update.ts");
    const code = await runUpdate(tmpDir);
    assertEquals(code !== 0, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("update: produces no stdout or stderr output", async () => {
  const result = await runIndex(["update"]);
  assertEquals(new TextDecoder().decode(result.stdout), "");
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test(
  "tick.sh: calls lazyboy update with || true guard before exec deno",
  async () => {
    const tickSh = new URL("../scripts/tick.sh", import.meta.url).pathname;
    const content = await Deno.readTextFile(tickSh);
    const lines = content.split("\n");
    const updateIdx = lines.findIndex(
      (l) => l.includes("lazyboy") && l.includes("update"),
    );
    const execIdx = lines.findIndex((l) => /^\s*exec\s+deno\b/.test(l));
    assertEquals(updateIdx !== -1, true);
    assertEquals(lines[updateIdx].trimEnd().endsWith("|| true"), true);
    assertEquals(updateIdx < execIdx, true);
  },
);
