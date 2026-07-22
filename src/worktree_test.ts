import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { WorktreeInfo } from "./state/types.ts";
import {
  cloneRemoteRepo,
  createWorktree,
  extractGitHubSlug,
  findLocalRepo,
  parseIntakeScope,
  parseRemoteSlug,
  resolveGitHubSlug,
  runGit,
} from "./worktree.ts";

// ── extractGitHubSlug ────────────────────────────────────────────────────────

Deno.test("extractGitHubSlug: extracts slug from issue URL", () => {
  assertEquals(
    extractGitHubSlug("https://github.com/jackjennings/lazyboy/issues/42"),
    "jackjennings/lazyboy",
  );
});

Deno.test("extractGitHubSlug: works with PR URLs", () => {
  assertEquals(
    extractGitHubSlug("https://github.com/myorg/myrepo/pull/7"),
    "myorg/myrepo",
  );
});

Deno.test("extractGitHubSlug: throws on non-GitHub URL", () => {
  assertThrows(
    () => extractGitHubSlug("https://example.com/foo"),
    Error,
    "Cannot extract GitHub slug",
  );
});

// ── parseRemoteSlug ──────────────────────────────────────────────────────────

Deno.test("parseRemoteSlug: extracts slug from HTTPS remote with .git suffix", () => {
  assertEquals(
    parseRemoteSlug("https://github.com/jackjennings/lazyboy.git"),
    "jackjennings/lazyboy",
  );
});

Deno.test("parseRemoteSlug: extracts slug from HTTPS remote without .git suffix", () => {
  assertEquals(
    parseRemoteSlug("https://github.com/jackjennings/lazyboy"),
    "jackjennings/lazyboy",
  );
});

Deno.test("parseRemoteSlug: extracts slug from SSH remote with .git suffix", () => {
  assertEquals(
    parseRemoteSlug("git@github.com:jackjennings/lazyboy.git"),
    "jackjennings/lazyboy",
  );
});

Deno.test("parseRemoteSlug: extracts slug from SSH remote without .git suffix", () => {
  assertEquals(
    parseRemoteSlug("git@github.com:jackjennings/lazyboy"),
    "jackjennings/lazyboy",
  );
});

Deno.test("parseRemoteSlug: returns null for non-GitHub remote", () => {
  assertEquals(
    parseRemoteSlug("https://gitlab.com/jackjennings/lazyboy.git"),
    null,
  );
});

Deno.test("parseRemoteSlug: returns null for empty string", () => {
  assertEquals(parseRemoteSlug(""), null);
});

// ── findLocalRepo ────────────────────────────────────────────────────────────

Deno.test("findLocalRepo: finds repo by matching origin remote", async () => {
  const root = await Deno.makeTempDir();
  const orgDir = join(root, "jackjennings");
  const repoDir = join(orgDir, "lazyboy");
  await Deno.mkdir(repoDir, { recursive: true });
  await new Deno.Command("git", { args: ["init"], cwd: repoDir }).output();
  await new Deno.Command("git", {
    args: [
      "remote",
      "add",
      "origin",
      "https://github.com/jackjennings/lazyboy.git",
    ],
    cwd: repoDir,
  }).output();

  const result = await findLocalRepo([root], "jackjennings/lazyboy");
  assertEquals(result, repoDir);

  await Deno.remove(root, { recursive: true });
});

Deno.test("findLocalRepo: skips non-git org-level directories", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "someorg"));
  const result = await findLocalRepo([root], "jackjennings/lazyboy");
  assertEquals(result, null);
  await Deno.remove(root, { recursive: true });
});

Deno.test("findLocalRepo: returns null when no repo matches", async () => {
  const root = await Deno.makeTempDir();
  const result = await findLocalRepo([root], "jackjennings/lazyboy");
  assertEquals(result, null);
  await Deno.remove(root, { recursive: true });
});

Deno.test("findLocalRepo: skips non-git directories", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "notarepo"));
  const result = await findLocalRepo([root], "jackjennings/lazyboy");
  assertEquals(result, null);
  await Deno.remove(root, { recursive: true });
});

Deno.test("findLocalRepo: returns null for nonexistent root", async () => {
  const result = await findLocalRepo(
    ["/nonexistent/path"],
    "jackjennings/lazyboy",
  );
  assertEquals(result, null);
});

// ── createWorktree ───────────────────────────────────────────────────────────

Deno.test("createWorktree: creates branch and worktree directory", async () => {
  const repoDir = await Deno.makeTempDir();
  const ticketId = `gh-test-${Date.now()}`;
  let info: WorktreeInfo | undefined;

  try {
    await new Deno.Command("git", { args: ["init"], cwd: repoDir }).output();
    await new Deno.Command("git", {
      args: ["config", "user.email", "test@test.com"],
      cwd: repoDir,
    }).output();
    await new Deno.Command("git", {
      args: ["config", "user.name", "Test"],
      cwd: repoDir,
    }).output();
    await new Deno.Command("git", {
      args: ["config", "commit.gpgsign", "false"],
      cwd: repoDir,
    }).output();
    await Deno.writeTextFile(join(repoDir, "README.md"), "test");
    await new Deno.Command("git", { args: ["add", "."], cwd: repoDir })
      .output();
    await new Deno.Command("git", {
      args: ["commit", "-m", "init"],
      cwd: repoDir,
    }).output();
    await new Deno.Command("git", {
      args: ["branch", "-m", "main"],
      cwd: repoDir,
    }).output();

    info = await createWorktree(repoDir, ticketId, "jackjennings/lazyboy");

    const stat = await Deno.stat(info.path);
    assertEquals(stat.isDirectory, true);
    assertEquals(info.branch, ticketId);
    assertEquals(info.path.endsWith("jackjennings/lazyboy"), true);
  } finally {
    // cleanup
    if (info) {
      await new Deno.Command("git", {
        args: ["worktree", "remove", "--force", info.path],
        cwd: repoDir,
      }).output();
    }
    await Deno.remove(
      join(Deno.env.get("HOME")!, ".lazyboy", "worktrees", ticketId),
      { recursive: true },
    );
    await Deno.remove(repoDir, { recursive: true });
  }
});

// ── parseIntakeScope ─────────────────────────────────────────────────────────

Deno.test("parseIntakeScope: returns [] for empty string", () => {
  assertEquals(parseIntakeScope(""), []);
});

Deno.test(
  "parseIntakeScope: returns [] when Proposed Scope section is absent",
  () => {
    assertEquals(parseIntakeScope("## Reasoning\n\nSome text.\n"), []);
  },
);

Deno.test(
  "parseIntakeScope: returns [] when fenced code block is absent",
  () => {
    assertEquals(
      parseIntakeScope("## Proposed Scope\n\nNo code block here.\n"),
      [],
    );
  },
);

Deno.test("parseIntakeScope: returns [] for empty scope list", () => {
  assertEquals(
    parseIntakeScope(
      "## Proposed Scope\n\n```yaml\nscope: []\n```\n\n## Reasoning\n\nText.\n",
    ),
    [],
  );
});

Deno.test("parseIntakeScope: extracts single local path entry", () => {
  const content =
    "## Proposed Scope\n\n```yaml\nscope:\n  - /code/myorg/repo\n```\n\n## Reasoning\n\nText.\n";
  assertEquals(parseIntakeScope(content), ["/code/myorg/repo"]);
});

Deno.test("parseIntakeScope: extracts multiple entries", () => {
  const content =
    "## Proposed Scope\n\n```yaml\nscope:\n  - ~/code/org/a\n  - org/repo\n```\n\n## Reasoning\n\nText.\n";
  assertEquals(parseIntakeScope(content), ["~/code/org/a", "org/repo"]);
});

Deno.test("parseIntakeScope: ignores content after the section", () => {
  const content =
    "## Proposed Scope\n\n```yaml\nscope:\n  - /code/repo\n```\n\n## Reasoning\n\nAnother section with ```yaml\nscope:\n  - /other\n````.\n";
  assertEquals(parseIntakeScope(content), ["/code/repo"]);
});

// ── resolveGitHubSlug ────────────────────────────────────────────────────────

Deno.test("resolveGitHubSlug: returns null for local absolute path", () => {
  assertEquals(resolveGitHubSlug("/code/myorg/repo"), null);
});

Deno.test("resolveGitHubSlug: returns null for tilde-prefixed path", () => {
  assertEquals(resolveGitHubSlug("~/code/myorg/repo"), null);
});

Deno.test("resolveGitHubSlug: returns slug for valid org/repo entry", () => {
  assertEquals(resolveGitHubSlug("myorg/myrepo"), "myorg/myrepo");
});

Deno.test(
  "resolveGitHubSlug: slug components allow dots, hyphens, underscores",
  () => {
    assertEquals(
      resolveGitHubSlug("my-org.v2/my_repo.v2"),
      "my-org.v2/my_repo.v2",
    );
  },
);

Deno.test(
  "resolveGitHubSlug: returns null for slug with more than two components",
  () => {
    assertEquals(resolveGitHubSlug("org/repo/extra"), null);
  },
);

Deno.test(
  "resolveGitHubSlug: returns null for single-component string",
  () => {
    assertEquals(resolveGitHubSlug("justarepo"), null);
  },
);

Deno.test(
  "resolveGitHubSlug: extracts slug from full github.com issue URL",
  () => {
    assertEquals(
      resolveGitHubSlug("https://github.com/myorg/myrepo/issues/1"),
      "myorg/myrepo",
    );
  },
);

Deno.test(
  "resolveGitHubSlug: extracts slug from bare github.com repo URL",
  () => {
    assertEquals(
      resolveGitHubSlug("https://github.com/myorg/myrepo"),
      "myorg/myrepo",
    );
  },
);

Deno.test(
  "resolveGitHubSlug: returns null for github.com URL with only org",
  () => {
    assertEquals(resolveGitHubSlug("https://github.com/myorg"), null);
  },
);

Deno.test(
  "resolveGitHubSlug: returns null for non-github https URL",
  () => {
    assertEquals(resolveGitHubSlug("https://gitlab.com/org/repo"), null);
  },
);

// ── cloneRemoteRepo ──────────────────────────────────────────────────────────

Deno.test(
  "cloneRemoteRepo: returns existing path without re-cloning",
  async () => {
    const home = await Deno.makeTempDir();
    const orgDir = join(home, ".lazyboy", "repositories", "org");
    const repoDir = join(orgDir, "repo");
    await Deno.mkdir(repoDir, { recursive: true });

    const originalHome = Deno.env.get("HOME")!;
    Deno.env.set("HOME", home);
    try {
      const result = await cloneRemoteRepo("org/repo", "");
      assertEquals(result, repoDir);
    } finally {
      Deno.env.set("HOME", originalHome);
      await Deno.remove(home, { recursive: true });
    }
  },
);

// ── runGit ───────────────────────────────────────────────────────────────────

Deno.test("runGit: returns stderr alongside stdout and code", async () => {
  const result = await runGit(
    ["invalid-subcommand-that-does-not-exist"],
    Deno.cwd(),
  );
  assertEquals(result.code !== 0, true);
  assertEquals(typeof result.stderr, "string");
  assertEquals(result.stderr.length > 0, true);
});
