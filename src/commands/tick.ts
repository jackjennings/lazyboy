import { loadConfig } from "../config.ts";
import { composeTickDeps } from "../compose.ts";
import { appendTickLog, TickService } from "../tick.ts";
import { runUpdate } from "./update.ts";
import type { Command } from "./types.ts";

export type TickUpdateDeps = {
  updateFn: (dir: string) => Promise<{ code: number; pulled: boolean }>;
  logFn: typeof appendTickLog;
  reexecFn: (indexPath: string) => Promise<void>;
};

export async function performTickUpdate(
  deps: TickUpdateDeps,
): Promise<boolean> {
  const srcDir = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
  const { code, pulled } = await deps.updateFn(srcDir);
  if (code !== 0) {
    await deps.logFn({ event: "update-failed", code });
    return true;
  }
  if (pulled) {
    const indexPath = new URL("../../index.ts", import.meta.url).pathname;
    await deps.reexecFn(indexPath);
    return false;
  }
  return true;
}

async function defaultReexec(indexPath: string): Promise<void> {
  const p = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", indexPath, "tick", ...Deno.args],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const { code } = await p.status;
  Deno.exit(code);
}

export const tick: Command = {
  name: "tick",
  description: "advance all active tickets",
  async run(_args) {
    if (
      !(await performTickUpdate({
        updateFn: runUpdate,
        logFn: appendTickLog,
        reexecFn: defaultReexec,
      }))
    ) return;
    const config = await loadConfig();
    const deps = composeTickDeps(config);
    await new TickService(deps).run();
  },
};
