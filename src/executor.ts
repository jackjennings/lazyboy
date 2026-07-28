import type { WorktreeInfo } from "./state/types.ts";

export interface ExecutorOptions {
  ticketDir: string;
  stateDir: string;
  prompt: string;
  scopeDirs: string[];
  outputFile: string;
  githubToken: string;
  anthropicApiKey: string;
  worktrees: Record<string, WorktreeInfo>;
  provider: string;
  model: string;
  thinking: string;
  agent: "pi" | "claude-code";
  contextFiles?: string[];
  pidFile?: string;
  sessionId?: string;
}

export function isProcessAlive(pid: number): boolean {
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
  const args = [
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
  args.push(
    "--provider",
    opts.provider,
    "--model",
    opts.model,
    "--thinking",
    opts.thinking,
    "--agent",
    opts.agent,
  );
  args.push("--state-dir", opts.stateDir);
  if (opts.contextFiles) {
    args.push("--context-files", opts.contextFiles.join(","));
  }
  if (opts.sessionId) {
    args.push("--session-id", opts.sessionId);
  }
  return args;
}

export function buildPhaseEnvOverrides(
  opts: ExecutorOptions,
): Record<string, string> {
  return {
    GITHUB_TOKEN: opts.githubToken,
    GH_TOKEN: opts.githubToken,
    ANTHROPIC_API_KEY: opts.anthropicApiKey,
  };
}

export async function spawnPhase(opts: ExecutorOptions): Promise<void> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: buildPhaseArgs(opts),
    env: {
      ...Deno.env.toObject(),
      ...buildPhaseEnvOverrides(opts),
    },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  const child = cmd.spawn();
  child.unref();
  await Deno.writeTextFile(
    `${opts.ticketDir}/${opts.pidFile ?? "run.pid"}`,
    child.pid.toString(),
  );
}

export function isPhaseAlive(ticketDir: string): boolean {
  let content: string;
  try {
    content = Deno.readTextFileSync(`${ticketDir}/run.pid`);
  } catch {
    return false;
  }
  const pid = parseInt(content.trim(), 10);
  if (isNaN(pid)) return false;
  return isProcessAlive(pid);
}

export async function deleteRunPid(ticketDir: string): Promise<void> {
  try {
    await Deno.remove(`${ticketDir}/run.pid`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}
