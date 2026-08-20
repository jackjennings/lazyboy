import type { Check, CheckResult } from "./checks/types.ts";

function formatCheckLine(check: Check, result: CheckResult): string {
  const label = result.status.toUpperCase();
  const lines = [`[${label}] ${check.description}`];
  if (result.detail) lines.push(`       ${result.detail}`);
  if (result.remedy) lines.push(`       Remedy: ${result.remedy}`);
  return lines.join("\n");
}

export function formatDoctorReport(
  checks: Check[],
  results: CheckResult[],
): string {
  return checks.map((check, i) => formatCheckLine(check, results[i])).join(
    "\n",
  );
}
