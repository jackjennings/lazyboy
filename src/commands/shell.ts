import { readTicket } from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import type { Command } from "./types.ts";

export const shell: Command = {
  name: "shell",
  description: "open a shell in the worktree for a ticket",
  completesWith: "_ids",
  async run(args) {
    const id = args[0];
    if (!id) {
      console.error("Usage: lazyboy shell <ticket-id>");
      Deno.exit(1);
    }
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    let ticket;
    try {
      ticket = await readTicket(stateDir, id);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      Deno.exit(1);
    }
    const worktreeEntries = Object.values(ticket.worktrees);
    if (worktreeEntries.length === 0) {
      console.error(`No worktrees found for ${id}`);
      Deno.exit(1);
    }
    const worktreePath = worktreeEntries[0].path;
    let stat;
    try {
      stat = await Deno.stat(worktreePath);
    } catch {
      console.error(`shell: ${worktreePath}: not a directory`);
      Deno.exit(1);
    }
    if (!stat.isDirectory) {
      console.error(`shell: ${worktreePath}: not a directory`);
      Deno.exit(1);
    }
    const shellBin = Deno.env.get("SHELL") || "/bin/sh";
    const child = new Deno.Command(shellBin, {
      cwd: worktreePath,
      env: { ...Deno.env.toObject(), LAZYBOY_SUBSHELL: "1" },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    const shellStatus = await child.status;
    Deno.exit(shellStatus.code);
  },
};
