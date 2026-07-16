import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";
import type { CodeAgent } from "./agents/types.ts";
import { PiCodeAgent } from "./agents/pi.ts";

const PI_PROVIDER = "anthropic";
const PI_MODEL = "claude-sonnet-4-6";

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

export async function buildContextFiles(ticketDir: string): Promise<string[]> {
  const contextFiles = [`@${ticketDir}/meta.md`];
  for (const phase of ["intake", "enrichment", "spec", "plan"]) {
    const phaseFiles: string[] = [];
    const prefixPattern = new RegExp(`^\\d{8}T\\d{6}-${phase}[.-]`);
    try {
      for await (const entry of Deno.readDir(ticketDir)) {
        if (
          entry.isFile &&
          prefixPattern.test(entry.name) &&
          entry.name.endsWith(".md")
        ) {
          phaseFiles.push(entry.name);
        }
      }
    } catch {
      /* ticketDir not found */
    }
    phaseFiles.sort();
    for (const f of phaseFiles) {
      contextFiles.push(`@${ticketDir}/${f}`);
    }
  }
  return contextFiles;
}

export async function appendPhaseLog(
  ticketDir: string,
  entry: object,
): Promise<void> {
  await Deno.writeTextFile(
    join(ticketDir, "log.ndjson"),
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    { append: true },
  );
}

export async function executePhase(
  opts: {
    ticketDir: string;
    outputFile: string;
    phase: string;
    scopeDirs: string[];
    prompt: string;
    worktrees: Record<string, { path: string; branch: string }>;
    homeDir: string;
    model?: string;
    contextFiles?: string[];
  },
  agent: CodeAgent,
): Promise<number> {
  await setupPiDirectories(opts.homeDir);
  const piEnv = getPiEnvironmentVariables(opts.homeDir);
  const contextFiles = opts.contextFiles ??
    await buildContextFiles(opts.ticketDir);

  const allPaths = [
    ...opts.scopeDirs,
    ...Object.values(opts.worktrees).map((w) => w.path),
  ];
  const pathContext = `\n\nTicket directory: ${opts.ticketDir}` +
    (allPaths.length > 0
      ? `\n\nAvailable directories:\n${
        allPaths.map((p) => `- ${p}`).join("\n")
      }`
      : "");

  const worktreePaths = Object.values(opts.worktrees).map((w) => w.path);
  const cwd = worktreePaths[0] ?? opts.ticketDir;

  await appendPhaseLog(opts.ticketDir, {
    event: "phase-start",
    phase: opts.phase,
  });

  const result = await agent.runPhase({
    prompt: opts.prompt + pathContext,
    contextFiles,
    cwd,
    env: {
      ...Deno.env.toObject(),
      ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      ...piEnv,
    },
    provider: PI_PROVIDER,
    model: opts.model ?? PI_MODEL,
  });

  await Deno.writeTextFile(
    join(opts.ticketDir, opts.outputFile),
    result.stdout,
  );

  await appendPhaseLog(opts.ticketDir, {
    event: "phase-end",
    phase: opts.phase,
    exitCode: result.code,
    output: result.stderr,
  });

  return result.code;
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: [
      "ticket-dir",
      "output-file",
      "phase",
      "scope",
      "prompt",
      "worktrees",
      "model",
      "context-files",
    ],
  });

  const ticketDir = args["ticket-dir"]!;
  const outputFile = args["output-file"]!;
  const phase = args["phase"]!;
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

  const homeDir = Deno.env.get("HOME");
  if (!homeDir) {
    throw new Error("HOME environment variable is not set");
  }

  const contextFiles = args["context-files"]
    ? args["context-files"].split(",").filter(Boolean)
    : undefined;

  const code = await executePhase(
    {
      ticketDir,
      outputFile,
      phase,
      scopeDirs,
      prompt,
      worktrees,
      homeDir,
      model: args["model"],
      contextFiles,
    },
    new PiCodeAgent(),
  );
  Deno.exit(code);
}
