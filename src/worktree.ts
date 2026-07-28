import { join } from "@std/path";
import type { WorktreeInfo } from "./state/types.ts";

export function extractGitHubSlug(url: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) throw new Error(`Cannot extract GitHub slug from URL: ${url}`);
  return match[1];
}

export function parseRemoteSlug(url: string): string | null {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
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

export async function runGh(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await new Deno.Command("gh", {
    args,
    cwd,
    env: env ? { ...Deno.env.toObject(), ...env } : undefined,
  }).output();
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

export interface RepoCandidate {
  slug: string;
  localPath: string | null;
}

export async function listRepoCorpus(
  roots: string[],
  configuredRepos: string[],
): Promise<RepoCandidate[]> {
  const bySlug = new Map<string, RepoCandidate>();

  for (const root of roots) {
    try {
      for await (const orgEntry of Deno.readDir(root)) {
        if (!orgEntry.isDirectory) continue;
        const orgPath = join(root, orgEntry.name);
        try {
          for await (const repoEntry of Deno.readDir(orgPath)) {
            if (!repoEntry.isDirectory) continue;
            const repoPath = join(orgPath, repoEntry.name);
            const { code, stdout } = await runGit(
              ["remote", "get-url", "origin"],
              repoPath,
            );
            if (code !== 0) continue;
            const slug = parseRemoteSlug(stdout);
            if (!slug) continue;
            bySlug.set(slug, { slug, localPath: repoPath });
          }
        } catch {
          // org-level directory is not readable — skip
        }
      }
    } catch {
      // root doesn't exist or isn't readable — skip
    }
  }

  for (const slug of configuredRepos) {
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { slug, localPath: null });
    }
  }

  return [...bySlug.values()];
}

export function formatRepoCorpus(candidates: RepoCandidate[]): string {
  if (candidates.length === 0) return "";
  const lines = candidates.map((c) =>
    c.localPath
      ? `- ${c.slug} (checked out at ${c.localPath})`
      : `- ${c.slug} (not checked out locally)`
  );
  return ["## Available Repositories", "", ...lines].join("\n") + "\n";
}

export function parseIntakeScope(content: string): string[] {
  const sectionStart = content.search(/^## Proposed Scope$/m);
  if (sectionStart === -1) return [];
  const afterSection = content.slice(sectionStart);
  const codeBlockMatch = afterSection.match(/```yaml\n([\s\S]*?)```/);
  if (!codeBlockMatch) return [];
  const yaml = codeBlockMatch[1];
  const lines = yaml.split("\n");
  let inScope = false;
  const results: string[] = [];
  for (const line of lines) {
    if (/^scope:\s*$/.test(line)) {
      inScope = true;
      continue;
    }
    if (inScope) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        results.push(itemMatch[1].trim());
      } else if (line.trim() && !/^\s/.test(line)) {
        break;
      }
    }
  }
  return results;
}

const SLUG_RE = /^([a-zA-Z0-9_.\-]+)\/([a-zA-Z0-9_.\-]+)$/;
const GITHUB_URL_RE = /^\/([^/]+)\/([^/]+)/;

export function resolveGitHubSlug(entry: string): string | null {
  if (entry.startsWith("https://github.com/")) {
    const path = entry.slice("https://github.com".length);
    const match = path.match(GITHUB_URL_RE);
    if (!match || !match[2]) return null;
    return `${match[1]}/${match[2]}`;
  }
  if (entry.startsWith("/") || entry.startsWith("~/")) return null;
  const match = entry.match(SLUG_RE);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export async function cloneRemoteRepo(
  slug: string,
  token: string,
): Promise<string> {
  const home = Deno.env.get("HOME")!;
  const [org, repo] = slug.split("/");
  const orgDir = join(home, ".lazyboy", "repositories", org);
  const repoDir = join(orgDir, repo);
  await Deno.mkdir(orgDir, { recursive: true });
  try {
    await Deno.stat(repoDir);
    return repoDir;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const env = token ? { GH_TOKEN: token } : undefined;
  const { code, stderr } = await runGh(
    [
      "repo",
      "clone",
      `https://github.com/${slug}`,
      repo,
      "--",
      "--depth",
      "1",
      "--single-branch",
    ],
    orgDir,
    env,
  );
  if (code !== 0) {
    throw new Error(`gh repo clone failed for ${slug}: ${stderr}`);
  }
  return repoDir;
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

export async function removeWorktree(wt: WorktreeInfo): Promise<void> {
  const { code: revParseCode, stdout: gitDir } = await runGit(
    ["rev-parse", "--git-common-dir"],
    wt.path,
  );
  if (revParseCode !== 0) {
    throw new Error(`git rev-parse --git-common-dir failed for ${wt.path}`);
  }
  const mainRepoPath = gitDir.replace(/[/\\]\.git$/, "");

  const { code: removeCode, stderr: removeErr } = await runGit(
    ["worktree", "remove", wt.path],
    mainRepoPath,
  );
  if (removeCode !== 0) {
    throw new Error(`git worktree remove failed: ${removeErr}`);
  }

  const { code: branchCode, stderr: branchErr } = await runGit(
    ["branch", "-D", wt.branch],
    mainRepoPath,
  );
  if (branchCode !== 0) {
    throw new Error(`git branch -D failed: ${branchErr}`);
  }
}
