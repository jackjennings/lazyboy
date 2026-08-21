import { join } from "@std/path";
import type { Check, CheckResult, CommandRunner } from "./types.ts";

const LABEL = "com.jackjennings.urras";

export interface LaunchdSpawnSuppressionDeps {
  readTextFile: (path: string) => Promise<string>;
  urrasDir: string;
  runCommand: CommandRunner;
  uid: number;
  plistPath: string;
  now: () => number;
}

export function launchdSpawnSuppressionCheck(
  deps: LaunchdSpawnSuppressionDeps,
): Check {
  return {
    id: "launchd-spawn-suppression",
    description: "Launchd is not in on-demand-only mode",
    async run(): Promise<CheckResult> {
      let logContent: string;
      try {
        logContent = await deps.readTextFile(
          join(deps.urrasDir, "tick.ndjson"),
        );
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          return { status: "pass", detail: "" };
        }
        throw e;
      }

      const entries = logContent
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l) as { ts: string; event: string };
          } catch {
            return null;
          }
        })
        .filter((e): e is { ts: string; event: string } => e !== null);

      const tickStarts = entries.filter((e) => e.event === "tick-start");
      if (tickStarts.length === 0) {
        return { status: "pass", detail: "" };
      }
      const lastStart = tickStarts[tickStarts.length - 1];
      const lastStartEpoch = Math.floor(
        Temporal.Instant.from(lastStart.ts).epochMilliseconds / 1000,
      );

      let startInterval = 300;
      try {
        const plist = await deps.readTextFile(deps.plistPath);
        const match = plist.match(
          /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/,
        );
        if (match) startInterval = parseInt(match[1], 10);
      } catch {
        // plist absent — use default
      }

      const elapsed = deps.now() - lastStartEpoch;
      if (elapsed <= 2 * startInterval) {
        return { status: "pass", detail: "" };
      }

      const printResult = await deps.runCommand([
        "launchctl",
        "print",
        `gui/${deps.uid}/${LABEL}`,
      ]);
      const runsMatch = printResult.stdout.match(/\bruns\s*=\s*(\d+)/);
      const runs = runsMatch ? parseInt(runsMatch[1], 10) : 0;

      if (runs === 0) {
        return { status: "pass", detail: "" };
      }

      const details: string[] = [
        `Possible spawn suppression: ${
          Math.round(elapsed / 60)
        }min since last tick-start (expected ≤${
          Math.round(2 * startInterval / 60)
        }min), job has run ${runs} time${runs === 1 ? "" : "s"} previously`,
      ];

      const logResult = await deps.runCommand(
        [
          "log",
          "show",
          "--last",
          "3h",
          "--predicate",
          `eventMessage CONTAINS "${LABEL}"`,
        ],
        10_000,
      );
      if (
        logResult.code === 0 &&
        logResult.stdout.includes(
          "pending spawn, domain in on-demand-only mode",
        )
      ) {
        details.push("confirmed: log shows on-demand-only mode");
      }

      return {
        status: "fail",
        detail: details.join(" — "),
        remedy: "Log out and back in to rebuild the gui/<uid> domain. " +
          "Workaround: add a cron entry running `launchctl kickstart gui/" +
          deps.uid +
          "/" +
          LABEL +
          "`. " +
          "Note: bootout/bootstrap of the job alone does not fix this — the mode is a domain property.",
      };
    },
  };
}
