import type {
  Check,
  CheckResult,
  CheckStatus,
  CommandRunner,
} from "./types.ts";

export interface StateRepoDeps {
  runCommand: CommandRunner;
  stateDir: string;
}

function worstStatus(a: CheckStatus, b: CheckStatus): CheckStatus {
  if (a === "fail" || b === "fail") return "fail";
  if (a === "warn" || b === "warn") return "warn";
  return "pass";
}

export function stateRepoCheck(deps: StateRepoDeps): Check {
  return {
    id: "state-repo",
    description: "State repo is clean and GPG signing works",
    async run(): Promise<CheckResult> {
      const details: string[] = [];
      let status: CheckStatus = "pass";

      const porcelainResult = await deps.runCommand([
        "git",
        "-C",
        deps.stateDir,
        "status",
        "--porcelain",
      ]);
      if (porcelainResult.code === 0 && porcelainResult.stdout.trim()) {
        const lineCount = porcelainResult.stdout.trim().split("\n").length;
        status = worstStatus(status, "fail");
        details.push(
          `${lineCount} uncommitted change${lineCount === 1 ? "" : "s"}`,
        );
      }

      const logResult = await deps.runCommand([
        "git",
        "-C",
        deps.stateDir,
        "log",
        "--oneline",
        "@{u}..HEAD",
      ]);
      if (logResult.code === 0 && logResult.stdout.trim()) {
        const commitCount = logResult.stdout.trim().split("\n").length;
        status = worstStatus(status, "warn");
        details.push(
          `${commitCount} unpushed commit${commitCount === 1 ? "" : "s"}`,
        );
      }

      const signingKeyResult = await deps.runCommand([
        "git",
        "-C",
        deps.stateDir,
        "config",
        "--get-regexp",
        "signingkey",
      ]);
      const parts = signingKeyResult.stdout.trim().split(/\s+/);
      const keyId = parts.length >= 2
        ? parts[parts.length - 1]
        : (parts[0] ?? "");
      if (signingKeyResult.code !== 0 || !keyId) {
        status = worstStatus(status, "fail");
        details.push("GPG signing key not configured");
      } else {
        const gpgResult = await deps.runCommand(
          ["gpg", "--list-secret-keys", keyId],
          5_000,
        );
        if (gpgResult.code !== 0) {
          status = worstStatus(status, "fail");
          details.push(`GPG key ${keyId} not available in keyring`);
        }
      }

      return {
        status,
        detail: details.join("; "),
        remedy: status !== "pass"
          ? "Commit pending changes and ensure GPG agent is running (`gpg-connect-agent reloadagent /bye`)"
          : undefined,
      };
    },
  };
}
