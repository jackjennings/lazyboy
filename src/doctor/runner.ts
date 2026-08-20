import type { Check, CheckResult } from "./checks/types.ts";

export async function runChecks(checks: Check[]): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      results.push(await check.run());
    } catch (err) {
      results.push({
        status: "fail",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
