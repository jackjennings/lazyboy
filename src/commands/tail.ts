import { join } from "@std/path";
import { lazyboyDir } from "../paths.ts";
import { readTicket } from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import type { Command } from "./types.ts";

export async function resolveTicketLogPath(
  stateDir: string,
  id: string,
): Promise<string> {
  try {
    await readTicket(stateDir, id);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(`No such ticket: ${id}`);
    }
    throw e;
  }
  const logPath = join(stateDir, id, "log.ndjson");
  try {
    await Deno.stat(logPath);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(`No log file found for ${id}`);
    }
    throw e;
  }
  return logPath;
}

export const tail: Command = {
  name: "tail",
  description: "stream the tick log or a ticket's event log",
  usage: "lazyboy tail [ticket-id]",
  async run(args) {
    const id = args[0];
    let logPath: string;
    if (!id) {
      logPath = join(lazyboyDir(), "log.ndjson");
    } else {
      const config = await loadConfig();
      const stateDir = expandHome(config.state.dir);
      try {
        logPath = await resolveTicketLogPath(stateDir, id);
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        Deno.exit(1);
      }
    }
    const child = new Deno.Command("tail", {
      args: ["-f", logPath],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    const tailStatus = await child.status;
    Deno.exit(tailStatus.code);
  },
};
