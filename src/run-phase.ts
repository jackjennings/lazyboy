import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";

export function getPiEnvironmentVariables(
  home: string,
): Record<string, string> {
  return {
    PI_CODING_AGENT_DIR: join(home, ".lazyboy", "pi"),
    PI_CODING_AGENT_SESSION_DIR: join(home, ".lazyboy", "pi", "sessions"),
  };
}

export async function setupPiDirectories(home: string): Promise<void> {
  const sessionsDir = join(home, ".lazyboy", "pi", "sessions");
  await Deno.mkdir(sessionsDir, { recursive: true });
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: [
      "ticket-dir",
      "output-file",
      "scope",
      "prompt",
      "worktrees",
    ],
  });

  const ticketDir = args["ticket-dir"]!;
  const outputFile = args["output-file"]!;
  const scopeDirs = args["scope"]
    ? args["scope"].split(",").filter(Boolean)
    : [];
  const prompt = args["prompt"]!;
  const worktrees = args["worktrees"]
    ? (JSON.parse(args["worktrees"]) as Record<
      string,
      { path: string; branch: string }
    >)
    : {};

  const contextFiles = [`@${ticketDir}/meta.md`];
  for (const file of ["intake.md", "enrichment.md", "spec.md", "plan.md"]) {
    try {
      await Deno.stat(`${ticketDir}/${file}`);
      contextFiles.push(`@${ticketDir}/${file}`);
    } catch { /* not yet written */ }
  }

  const allPaths = [
    ...scopeDirs,
    ...Object.values(worktrees).map((w) => w.path),
  ];
  const pathContext = `\n\nTicket directory: ${ticketDir}` +
    (allPaths.length > 0
      ? `\n\nAvailable directories:\n${
        allPaths
          .map((p) => `- ${p}`)
          .join("\n")
      }`
      : "");

  const worktreePaths = Object.values(worktrees).map((w) => w.path);
  const cwd = worktreePaths[0] ?? ticketDir;

  const homeDir = Deno.env.get("HOME");
  if (!homeDir) {
    throw new Error("HOME environment variable is not set");
  }

  await setupPiDirectories(homeDir);
  const piEnv = getPiEnvironmentVariables(homeDir);

  const result = await new Deno.Command("pi", {
    args: [
      "-p",
      "--provider",
      "anthropic",
      "--model",
      "claude-haiku-4-5-20251001",
      "--system-prompt",
      prompt + pathContext,
      ...contextFiles,
    ],
    cwd,
    env: {
      ...Deno.env.toObject(),
      ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      ...piEnv,
    },
    stdout: "piped",
    stderr: "inherit",
  }).output();

  await Deno.writeTextFile(
    join(ticketDir, outputFile),
    new TextDecoder().decode(result.stdout),
  );
  Deno.exit(result.code);
}
