import { runGit } from "../worktree.ts";
import type { Command } from "./types.ts";

const lazboyDir = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export async function runUpdate(dir: string): Promise<number> {
  const { stdout } = await runGit(["status", "--porcelain"], dir);
  if (stdout !== "") {
    return 1;
  }
  const { code } = await runGit(["pull"], dir);
  return code;
}

export const update: Command = {
  name: "update",
  async run(_args) {
    Deno.exit(await runUpdate(lazboyDir));
  },
};
