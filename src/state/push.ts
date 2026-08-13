type RunGitFn = (
  args: string[],
  cwd: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

interface PushStateDeps {
  stateDir: string;
  runGit: RunGitFn;
  log: (entry: object) => Promise<void>;
}

export async function pushState({
  stateDir,
  runGit,
  log,
}: PushStateDeps): Promise<void> {
  const check = await runGit(["remote", "get-url", "origin"], stateDir);
  if (check.code !== 0) return;
  const push = await runGit(["push", "origin", "main"], stateDir);
  if (push.code !== 0) {
    await log({ event: "error", context: "pushState" });
  }
}
