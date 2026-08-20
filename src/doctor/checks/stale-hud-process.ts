import type { Check, CheckResult, CommandRunner } from "./types.ts";

export interface StaleHudProcessDeps {
  runCommand: CommandRunner;
  repoPath: string;
}

export function staleHudProcessCheck(deps: StaleHudProcessDeps): Check {
  return {
    id: "stale-hud-process",
    description: "No stale hud processes running pre-update code",
    async run(): Promise<CheckResult> {
      const pgrepResult = await deps.runCommand(["pgrep", "-f", "ur hud"]);
      if (pgrepResult.code !== 0 || !pgrepResult.stdout.trim()) {
        return { status: "pass", detail: "" };
      }

      const pids = pgrepResult.stdout.trim().split("\n").filter(Boolean);

      const headResult = await deps.runCommand([
        "git",
        "-C",
        deps.repoPath,
        "log",
        "-1",
        "--format=%ct",
        "HEAD",
      ]);
      if (headResult.code !== 0) {
        return {
          status: "warn",
          detail:
            "Could not determine HEAD commit timestamp to check hud staleness",
        };
      }
      const headEpochSeconds = parseInt(headResult.stdout.trim(), 10);

      const stalePids: string[] = [];
      for (const pid of pids) {
        const psResult = await deps.runCommand([
          "ps",
          "-p",
          pid,
          "-o",
          "lstart=",
        ]);
        if (psResult.code !== 0) continue;
        const processEpochMs = Date.parse(psResult.stdout.trim());
        if (isNaN(processEpochMs)) continue;
        const processEpochSeconds = Math.floor(processEpochMs / 1000);
        if (processEpochSeconds < headEpochSeconds) {
          stalePids.push(pid);
        }
      }

      if (stalePids.length === 0) {
        return { status: "pass", detail: "" };
      }
      return {
        status: "warn",
        detail: `Stale hud process${stalePids.length === 1 ? "" : "es"} (PID ${
          stalePids.join(", ")
        }) started before current HEAD`,
        remedy: `Kill the stale process: kill ${stalePids.join(" ")}`,
      };
    },
  };
}
