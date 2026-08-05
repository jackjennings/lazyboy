import { runGit } from "../worktree.ts";
import type { Command } from "./types.ts";

const lazboyDir = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export async function runUpdate(
  dir: string,
  runGitFn: typeof runGit = runGit,
): Promise<{ code: number; pulled: boolean }> {
  const { stdout } = await runGitFn(["status", "--porcelain"], dir);
  if (stdout !== "") {
    return { code: 1, pulled: false };
  }
  const { stdout: headBefore } = await runGitFn(["rev-parse", "HEAD"], dir);
  const { code } = await runGitFn(["pull"], dir);
  if (code !== 0) {
    return { code, pulled: false };
  }
  const { stdout: headAfter } = await runGitFn(["rev-parse", "HEAD"], dir);
  return { code: 0, pulled: headBefore !== headAfter };
}

export const update: Command = {
  name: "update",
  description: "pull latest lazyboy source",
  async run(_args) {
    const result = await runUpdate(lazboyDir);
    Deno.exit(result.code);
  },
};
