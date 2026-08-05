import { loadConfig } from "../config.ts";
import { composeTickDeps } from "../compose.ts";
import { appendTickLog, TickService } from "../tick.ts";
import { runUpdate } from "./update.ts";
import type { Command } from "./types.ts";

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

export async function performTickUpdate(opts?: {
  updateFn?: (dir: string) => Promise<{ code: number; pulled: boolean }>;
  logFn?: typeof appendTickLog;
  reexecFn?: (indexPath: string) => Promise<void>;
}): Promise<boolean> {
  const updateFn = opts?.updateFn ?? runUpdate;
  const logFn = opts?.logFn ?? appendTickLog;
  const reexecFn = opts?.reexecFn ?? defaultReexec;

  const srcDir = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
  const { code, pulled } = await updateFn(srcDir);
  if (code !== 0) {
    await logFn({ event: "update-failed", code });
    return true;
  }
  if (pulled) {
    const indexPath = new URL("../../index.ts", import.meta.url).pathname;
    await reexecFn(indexPath);
    return false;
  }
  return true;
}

export const tick: Command = {
  name: "tick",
  description: "advance all active tickets",
  async run(_args) {
    if (!(await performTickUpdate())) return;
    const config = await loadConfig();
    const deps = composeTickDeps(config);
    await new TickService(deps).run();
  },
};
