export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  status: CheckStatus;
  detail: string;
  remedy?: string;
}

export interface Check {
  id: string;
  description: string;
  run(): Promise<CheckResult>;
}

export type CommandRunner = (
  args: string[],
  timeoutMs?: number,
) => Promise<{ code: number; stdout: string }>;
