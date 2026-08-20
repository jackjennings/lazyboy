import type { Check, CheckResult, CommandRunner } from "./types.ts";

const REQUIRED_BINARIES = [
  "git",
  "pi",
  "launchctl",
  "apfel",
  "git-worktreeinclude",
];

export interface HostDependenciesDeps {
  runCommand: CommandRunner;
}

export function hostDependenciesCheck(deps: HostDependenciesDeps): Check {
  return {
    id: "host-dependencies",
    description: "Required host binaries are on PATH",
    async run(): Promise<CheckResult> {
      const missing: string[] = [];
      for (const bin of REQUIRED_BINARIES) {
        const result = await deps.runCommand(["which", bin]);
        if (result.code !== 0) missing.push(bin);
      }

      if (missing.length === 0) {
        return { status: "pass", detail: "" };
      }
      return {
        status: "fail",
        detail: `Missing binaries: ${missing.join(", ")}`,
        remedy: "Install missing tools and ensure they are on PATH",
      };
    },
  };
}
