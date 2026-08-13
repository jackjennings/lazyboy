type RunGitFn = (
  args: string[],
  cwd: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export async function pushStateIfOriginExists(
  stateDir: string,
  runGit: RunGitFn,
  log: (entry: object) => Promise<void>,
): Promise<void> {
  const check = await runGit(["remote", "get-url", "origin"], stateDir);
  if (check.code !== 0) return;
  const push = await runGit(["push", "origin", "main"], stateDir);
  if (push.code !== 0) {
    await log({ event: "error", context: "pushState" });
  }
}
