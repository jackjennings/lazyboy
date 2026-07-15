import { join } from "@std/path";
import type { WorktreeInfo } from "./state/types.ts";

export function extractGitHubSlug(url: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) throw new Error(`Cannot extract GitHub slug from URL: ${url}`);
  return match[1];
}

export async function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await new Deno.Command("git", { args, cwd }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  };
}

export async function findLocalRepo(
  roots: string[],
  slug: string,
): Promise<string | null> {
  for (const root of roots) {
    try {
      for await (const orgEntry of Deno.readDir(root)) {
        if (!orgEntry.isDirectory) continue;
        const orgPath = join(root, orgEntry.name);
        try {
          for await (const repoEntry of Deno.readDir(orgPath)) {
            if (!repoEntry.isDirectory) continue;
            const candidatePath = join(orgPath, repoEntry.name);
            const { code, stdout } = await runGit(
              ["remote", "get-url", "origin"],
              candidatePath,
            );
            if (code === 0 && stdout.includes(slug)) return candidatePath;
          }
        } catch {
          // org-level directory is not readable — skip
        }
      }
    } catch {
      // root doesn't exist or isn't readable — skip
    }
  }
  return null;
}

export async function createWorktree(
  repoPath: string,
  ticketId: string,
  slug: string,
): Promise<WorktreeInfo> {
  const home = Deno.env.get("HOME")!;
  const [org, repo] = slug.split("/");
  const worktreePath = join(home, ".lazyboy", "worktrees", ticketId, org, repo);
  await Deno.mkdir(join(home, ".lazyboy", "worktrees", ticketId, org), {
    recursive: true,
  });

  const { code } = await runGit(
    ["worktree", "add", "-b", ticketId, worktreePath, "main"],
    repoPath,
  );
  if (code !== 0) {
    throw new Error(
      `git worktree add failed for ticket ${ticketId} in ${repoPath}`,
    );
  }

  return { path: worktreePath, branch: ticketId };
}
