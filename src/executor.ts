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

export function buildPhaseArgs(opts: ExecutorOptions): string[] {
  const runPhaseScript = new URL("./run-phase.ts", import.meta.url).pathname;
  const phase = opts.outputFile.replace(/\.md$/, "");
  return [
    "run",
    "--allow-all",
    runPhaseScript,
    "--ticket-dir",
    opts.ticketDir,
    "--output-file",
    opts.outputFile,
    "--phase",
    phase,
    "--scope",
    opts.scopeDirs.join(","),
    "--prompt",
    opts.prompt,
    "--worktrees",
    JSON.stringify(opts.worktrees),
  ];
}

export function spawnPhase(opts: ExecutorOptions): number {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: buildPhaseArgs(opts),
    env: {
      ...Deno.env.toObject(),
      GITHUB_TOKEN: opts.githubToken,
      ANTHROPIC_API_KEY: opts.anthropicApiKey,
    },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  const child = cmd.spawn();
  child.unref();
  return child.pid;
}
