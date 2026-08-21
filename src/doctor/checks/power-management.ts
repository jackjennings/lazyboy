import type {
  Check,
  CheckResult,
  CheckStatus,
  CommandRunner,
} from "./types.ts";

export interface PowerManagementDeps {
  runCommand: CommandRunner;
}

function parseSleepValue(section: string): number | null {
  const match = section.match(/\bsleep\s+(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function sleepStatus(value: number): CheckStatus {
  if (value === 0) return "pass";
  if (value < 5) return "fail";
  return "warn";
}

function worstStatus(a: CheckStatus, b: CheckStatus): CheckStatus {
  if (a === "fail" || b === "fail") return "fail";
  if (a === "warn" || b === "warn") return "warn";
  return "pass";
}

export function powerManagementCheck(deps: PowerManagementDeps): Check {
  return {
    id: "power-management",
    description: "Power management settings allow ticks to fire",
    async run(): Promise<CheckResult> {
      const [assertionsResult, customResult, sourceResult] = await Promise.all([
        deps.runCommand(["pmset", "-g", "assertions"]),
        deps.runCommand(["pmset", "-g", "custom"]),
        deps.runCommand(["pmset", "-g"]),
      ]);

      const assertionActive = assertionsResult.code === 0 &&
        /PreventUserIdleSystemSleep\s+[1-9]/.test(assertionsResult.stdout);

      const sourceMatch = sourceResult.stdout.match(
        /Now drawing from '([^']+)'/,
      );
      const currentSource = sourceMatch?.[1] ?? "unknown";

      if (assertionActive) {
        return {
          status: "pass",
          detail:
            `PreventUserIdleSystemSleep is active (current source: ${currentSource})`,
        };
      }

      const details: string[] = [];
      let status: CheckStatus = "pass";

      const batterySectionMatch = customResult.stdout.match(
        /Battery Power:([\s\S]*?)(?=\n\S|\n\n\S|$)/,
      );
      const acSectionMatch = customResult.stdout.match(
        /AC Power:([\s\S]*?)(?=\n\S|\n\n\S|$)/,
      );

      const batterySleep = batterySectionMatch
        ? parseSleepValue(batterySectionMatch[1])
        : null;
      const acSleep = acSectionMatch
        ? parseSleepValue(acSectionMatch[1])
        : null;

      if (batterySleep !== null) {
        const s = sleepStatus(batterySleep);
        status = worstStatus(status, s);
        if (s !== "pass") {
          details.push(
            `Battery sleep ${batterySleep} min — ${
              s === "fail"
                ? "system will sleep before next tick fires"
                : "system may sleep between ticks"
            }`,
          );
        }
      }
      if (acSleep !== null) {
        const s = sleepStatus(acSleep);
        status = worstStatus(status, s);
        if (s !== "pass") {
          details.push(
            `AC sleep ${acSleep} min — ${
              s === "fail"
                ? "system will sleep before next tick fires"
                : "system may sleep between ticks"
            }`,
          );
        }
      }

      const sourceDetail = `current source: ${currentSource}`;
      const detail = details.length > 0
        ? `${details.join("; ")} (${sourceDetail})`
        : sourceDetail;

      return {
        status,
        detail,
        remedy: status !== "pass"
          ? "Run `pmset -a sleep 0` to prevent sleep, or `pmset -a sleep 5` to match the tick interval"
          : undefined,
      };
    },
  };
}
