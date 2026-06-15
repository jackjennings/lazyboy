export interface ExecutorOptions {
  ticketDir: string;
  prompt: string;
  scopeDirs: string[];
  outputFile: string;
  githubToken: string;
  anthropicApiKey: string;
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
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run", "--allow-all", runPhaseScript,
      "--ticket-dir", opts.ticketDir,
      "--output-file", opts.outputFile,
      "--scope", opts.scopeDirs.join(","),
      "--prompt", opts.prompt,
    ],
    env: {
      GITHUB_TOKEN: opts.githubToken,
      ANTHROPIC_API_KEY: opts.anthropicApiKey,
    },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  const child = cmd.spawn();
  return child.pid;
}
