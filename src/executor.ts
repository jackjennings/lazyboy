import type { WorktreeInfo } from "./state/types.ts";

export interface ExecutorOptions {
  ticketDir: string;
  prompt: string;
  scopeDirs: string[];
  outputFile: string;
  githubToken: string;
  anthropicApiKey: string;
  worktrees: Record<string, WorktreeInfo>;
}

export function isPidAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

export function spawnPhase(opts: ExecutorOptions): number {
  const runPhaseScript = new URL("./run-phase.ts", import.meta.url).pathname;
  const logPath = `${opts.ticketDir}/${opts.outputFile}.log`;
  const cmd = new Deno.Command("bash", {
    args: [
      "-c",
      `printf '\\n=== %s START %s ===\\n' "$(date -Iseconds)" "$PHASE_OUTPUT" >> "$LAZYBOY_LOG"
trap 'CODE=$?; printf "=== %s EXIT %s ===\\n" "$(date -Iseconds)" "$CODE" >> "$LAZYBOY_LOG"' EXIT
"$@" >> "$LAZYBOY_LOG" 2>&1`,
      "bash",
      Deno.execPath(),
      "run",
      "--allow-all",
      runPhaseScript,
      "--ticket-dir",
      opts.ticketDir,
      "--output-file",
      opts.outputFile,
      "--scope",
      opts.scopeDirs.join(","),
      "--prompt",
      opts.prompt,
      "--worktrees",
      JSON.stringify(opts.worktrees),
    ],
    env: {
      ...Deno.env.toObject(),
      GITHUB_TOKEN: opts.githubToken,
      ANTHROPIC_API_KEY: opts.anthropicApiKey,
      LAZYBOY_LOG: logPath,
      PHASE_OUTPUT: opts.outputFile,
    },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  const child = cmd.spawn();
  child.unref();
  return child.pid;
}
