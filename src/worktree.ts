import { join } from "@std/path";
import type { WorktreeInfo } from "./state/types.ts";
import { mkdir, readDir, stat } from "./filesystem.ts";

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

export const GIT_TIMEOUT_MS = 120_000;

const SSH_KEEPALIVE_COMMAND =
  "ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ConnectTimeout=30";

export async function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = {
    ...Deno.env.toObject(),
    ...(Deno.env.get("GIT_SSH_COMMAND") === undefined
      ? { GIT_SSH_COMMAND: SSH_KEEPALIVE_COMMAND }
      : {}),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GIT_TIMEOUT_MS);
  try {
    const result = await new Deno.Command("git", {
      args,
      cwd,
      env,
      signal: controller.signal,
    }).output();
    if (controller.signal.aborted) {
      const secs = Math.round(GIT_TIMEOUT_MS / 1000);
      return { code: 1, stdout: "", stderr: `git: timed out after ${secs}s` };
    }
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout).trim(),
      stderr: new TextDecoder().decode(result.stderr).trim(),
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      const secs = Math.round(GIT_TIMEOUT_MS / 1000);
      return { code: 1, stdout: "", stderr: `git: timed out after ${secs}s` };
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function findLocalRepo(
  roots: string[],
  slug: string,
): Promise<string | null> {
  for (const root of roots) {
    try {
      for await (const orgEntry of readDir(root)) {
        if (!orgEntry.isDirectory) continue;
        const orgPath = join(root, orgEntry.name);
        try {
          for await (const repoEntry of readDir(orgPath)) {
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
      for await (const orgEntry of readDir(root)) {
        if (!orgEntry.isDirectory) continue;
        const orgPath = join(root, orgEntry.name);
        try {
          for await (const repoEntry of readDir(orgPath)) {
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
  clone: (slug: string, destDir: string, cwd: string) => Promise<void>,
): Promise<string> {
  const home = Deno.env.get("HOME")!;
  const [org, repo] = slug.split("/");
  const orgDir = join(home, ".lazyboy", "repositories", org);
  const repoDir = join(orgDir, repo);
  await mkdir(orgDir, { recursive: true });
  try {
    await stat(repoDir);
    return repoDir;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  await clone(slug, repo, orgDir);
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
  await mkdir(join(home, ".lazyboy", "worktrees", ticketId, org), {
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
