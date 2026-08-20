import { join } from "@std/path";
import type {
  Check,
  CheckResult,
  CheckStatus,
  CommandRunner,
} from "./types.ts";

export interface SelfUpdateHealthDeps {
  runCommand: CommandRunner;
  repoPath: string;
  readTextFile: (path: string) => Promise<string>;
  urrasDir: string;
  now: () => number;
}

function worstStatus(a: CheckStatus, b: CheckStatus): CheckStatus {
  if (a === "fail" || b === "fail") return "fail";
  if (a === "warn" || b === "warn") return "warn";
  return "pass";
}

export function selfUpdateHealthCheck(deps: SelfUpdateHealthDeps): Check {
  return {
    id: "self-update-health",
    description: "Self-update is current and healthy",
    async run(): Promise<CheckResult> {
      const details: string[] = [];
      let status: CheckStatus = "pass";

      const [aheadResult, behindResult] = await Promise.all([
        deps.runCommand([
          "git",
          "-C",
          deps.repoPath,
          "rev-list",
          "--count",
          "@{u}..HEAD",
        ]),
        deps.runCommand([
          "git",
          "-C",
          deps.repoPath,
          "rev-list",
          "--count",
          "HEAD..@{u}",
        ]),
      ]);

      if (aheadResult.code !== 0 || behindResult.code !== 0) {
        status = worstStatus(status, "warn");
        details.push(
          "could not determine upstream relationship (no upstream configured?)",
        );
      } else {
        const ahead = parseInt(aheadResult.stdout.trim(), 10);
        const behind = parseInt(behindResult.stdout.trim(), 10);
        if (ahead > 0) {
          status = worstStatus(status, "warn");
          details.push(
            `${ahead} commit${ahead === 1 ? "" : "s"} ahead of upstream`,
          );
        }
        if (behind > 0) {
          status = worstStatus(status, "warn");
          details.push(
            `${behind} commit${
              behind === 1 ? "" : "s"
            } behind upstream — run \`git pull\``,
          );
        }
      }

      const sevenDaysAgo = deps.now() - 7 * 24 * 60 * 60;
      let logContent = "";
      try {
        logContent = await deps.readTextFile(
          join(deps.urrasDir, "tick.ndjson"),
        );
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }

      const recentEntries = logContent
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l) as { ts: string; event: string };
          } catch {
            return null;
          }
        })
        .filter((e): e is { ts: string; event: string } => e !== null)
        .filter(
          (e) =>
            Math.floor(Temporal.Instant.from(e.ts).epochMilliseconds / 1000) >=
              sevenDaysAgo,
        );

      const updateFailed = recentEntries.filter(
        (e) => e.event === "update-failed",
      );
      if (updateFailed.length > 0) {
        status = worstStatus(status, "fail");
        details.push(
          `${updateFailed.length} update-failed event${
            updateFailed.length === 1 ? "" : "s"
          } in last 7 days`,
        );
      }

      const updateSkipped = recentEntries.filter(
        (e) => e.event === "update-skipped",
      );
      if (updateSkipped.length >= 3) {
        status = worstStatus(status, "warn");
        details.push(
          `${updateSkipped.length} update-skipped events in last 7 days`,
        );
      }

      return {
        status,
        detail: details.join("; "),
        remedy: status !== "pass"
          ? "Run `ur update` or `git pull` in the urras repo"
          : undefined,
      };
    },
  };
}
