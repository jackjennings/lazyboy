import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { WorktreeInfo } from "./state/types.ts";
import {
  createWorktree,
  extractGitHubSlug,
  findLocalRepo,
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

// ── findLocalRepo ────────────────────────────────────────────────────────────

Deno.test("findLocalRepo: finds repo by matching origin remote", async () => {
  const root = await Deno.makeTempDir();
  const repoDir = join(root, "lazyboy");
  await Deno.mkdir(repoDir);
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
