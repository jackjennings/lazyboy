import { parseArgs } from "@std/cli/parse-args";
import { PHASE_SEQUENCE } from "./phases/types.ts";
import { join } from "@std/path";
import type { CodeAgent } from "./agents/types.ts";
import { PiCodeAgent } from "./agents/pi.ts";
import { ClaudeCodeAgent } from "./agents/claude-code.ts";
import type { PhaseUsage } from "./state/types.ts";
import {
  type AnthropicPricingCache,
  calculateAnthropicCost,
} from "./anthropic-pricing.ts";

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

export async function setupClaudeCodeDirectories(home: string): Promise<void> {
  const claudeCodeDir = join(home, ".lazyboy", "claude-code");
  await Deno.mkdir(claudeCodeDir, { recursive: true });
  const settingsPath = join(claudeCodeDir, "settings.json");
  try {
    await Deno.stat(settingsPath);
  } catch {
    await Deno.writeTextFile(
      settingsPath,
      JSON.stringify({ attribution: { commit: "", pr: "" } }),
    );
  }
}

function selectLatestPhaseFiles(
  sortedFiles: string[],
  phase: string,
): string[] {
  if (sortedFiles.length === 0) return [];
  const docSuffix = `-${phase}.md`;
  const latest = sortedFiles[sortedFiles.length - 1];
  if (latest.endsWith(docSuffix)) {
    return [latest];
  }
  for (let i = sortedFiles.length - 2; i >= 0; i--) {
    if (sortedFiles[i].endsWith(docSuffix)) {
      return [sortedFiles[i], latest];
    }
  }
  return [latest];
}

export async function buildContextFiles(
  { ticketDir, stateDir }: { ticketDir: string; stateDir: string },
): Promise<string[]> {
  const principlesPath = join(stateDir, "principles.md");
  const contextFiles: string[] = [];
  try {
    await Deno.stat(principlesPath);
    contextFiles.push(`@${principlesPath}`);
  } catch {
    /* principles.md doesn't exist yet */
  }
  contextFiles.push(`@${ticketDir}/meta.md`);
  for (const phase of PHASE_SEQUENCE) {
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
    for (const f of selectLatestPhaseFiles(phaseFiles, phase)) {
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

export function extractSessionId(ndjson: string): string | null {
  const lines = ndjson.split("\n").filter(Boolean);
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.type === "session" && typeof event.id === "string") {
      return event.id;
    }
  }
  return null;
}

export function extractUsageAndText(
  ndjson: string,
  durationMs: number,
): { text: string; usage: PhaseUsage | null } {
  const lines = ndjson.split("\n").filter(Boolean);
  const events = lines.map((l) => JSON.parse(l));
  const agentEnd = events.find((e) => e.type === "agent_end");
  if (!agentEnd) {
    return { text: "", usage: null };
  }
  const assistantMessages = (agentEnd.messages as {
    role: string;
    model?: string;
    content: { type: string; text?: string }[];
    usage?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
  }[]).filter((m) => m.role === "assistant");

  let lastText = "";
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let model = "";

  for (const msg of assistantMessages) {
    const msgText = msg.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    if (msgText) lastText = msgText;
    if (msg.usage) {
      input += msg.usage.input;
      output += msg.usage.output;
      cacheRead += msg.usage.cacheRead;
      cacheWrite += msg.usage.cacheWrite;
    }
    if (msg.model) model = msg.model;
  }

  return {
    text: lastText,
    usage: {
      input,
      output,
      cacheRead,
      cacheWrite,
      model,
      durationMs,
      turns: assistantMessages.length,
    },
  };
}

export function extractClaudeCodeSessionId(ndjson: string): string | null {
  const lines = ndjson.split("\n").filter(Boolean);
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.type === "system" && typeof event.session_id === "string") {
      return event.session_id;
    }
  }
  return null;
}

export function extractClaudeCodeUsageAndText(
  ndjson: string,
  durationMs: number,
): { text: string; usage: PhaseUsage | null } {
  const lines = ndjson.split("\n").filter(Boolean);
  const events = lines.map((l) => JSON.parse(l));
  const result = events.find((e) => e.type === "result");
  if (!result) {
    return { text: "", usage: null };
  }
  // `result.usage` is per-run, not cumulative across a `--resume`: a resumed
  // turn reports only that invocation's tokens, so this is the phase's usage
  // even for implementation-revision runs. Verified empirically against the
  // claude CLI's stream-json output.
  const usage = result.usage as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | undefined;

  const modelUsage = result.modelUsage as Record<string, unknown> | undefined;
  const model = modelUsage
    ? (Object.keys(modelUsage)[0] ?? "").replace(/\[[^\]]*\]$/, "")
    : "";

  return {
    text: typeof result.result === "string" ? result.result : "",
    usage: {
      input: usage?.input_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      cacheRead: usage?.cache_read_input_tokens ?? 0,
      cacheWrite: usage?.cache_creation_input_tokens ?? 0,
      model,
      durationMs,
      turns: typeof result.num_turns === "number"
        ? result.num_turns
        : undefined,
    },
  };
}

export function resolveRevisionSessionId(logContent: string): string | null {
  const parsed: { event: string; phase?: string; sessionId?: string }[] = [];
  for (const line of logContent.split("\n").filter(Boolean)) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  let lastIdx = -1;
  let lastSessionId: string | null = null;
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (
      entry.event === "phase-end" &&
      entry.phase === "implementation" &&
      typeof entry.sessionId === "string" &&
      entry.sessionId.length > 0
    ) {
      lastIdx = i;
      lastSessionId = entry.sessionId;
    }
  }

  if (lastIdx === -1) return null;

  for (let i = lastIdx + 1; i < parsed.length; i++) {
    if (parsed[i].event === "conflict-resolution-started") return null;
  }

  return lastSessionId;
}

export function extractPrinciples(content: string): string | null {
  const match = content.match(
    /(?:^|\n)## Principles\n([\s\S]*?)(?=\n## |\n*$)/,
  );
  if (!match) return null;
  const body = match[1].trim();
  return body.length > 0 ? body : null;
}

export async function executePhase(
  opts: {
    ticketDir: string;
    stateDir: string;
    outputFile: string;
    phase: string;
    scopeDirs: string[];
    prompt: string;
    worktrees: Record<string, { path: string; branch: string }>;
    homeDir: string;
    provider: string;
    model: string;
    thinking: string;
    agentType: "pi" | "claude-code";
    contextFiles?: string[];
    sessionId?: string;
  },
  agent: CodeAgent,
): Promise<number> {
  let env: Record<string, string> = {
    ...Deno.env.toObject(),
    ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  };

  if (opts.agentType === "pi") {
    await setupPiDirectories(opts.homeDir);
    const piEnv = getPiEnvironmentVariables(opts.homeDir);
    env = { ...env, ...piEnv };
  } else {
    await setupClaudeCodeDirectories(opts.homeDir);
  }

  const contextFiles = opts.contextFiles ??
    await buildContextFiles({
      ticketDir: opts.ticketDir,
      stateDir: opts.stateDir,
    });

  const allPaths = [
    ...opts.scopeDirs,
    ...Object.values(opts.worktrees).map((w) => w.path),
  ];
  const outputFilePath = join(opts.ticketDir, opts.outputFile);
  const pathContext = `\n\nOutput file: ${outputFilePath}` +
    `\n\nTicket directory: ${opts.ticketDir}` +
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

  try {
    await Deno.remove(outputFilePath);
  } catch {
    // file didn't exist; nothing to do
  }

  const startMs = Temporal.Now.instant().epochMilliseconds;
  const result = await agent.runPhase({
    prompt: opts.prompt + pathContext,
    contextFiles,
    cwd,
    env,
    provider: opts.provider,
    model: opts.model,
    thinking: opts.thinking,
    sessionId: opts.sessionId,
  });
  const durationMs = Temporal.Now.instant().epochMilliseconds - startMs;

  const { usage } = opts.agentType === "claude-code"
    ? extractClaudeCodeUsageAndText(result.stdout, durationMs)
    : extractUsageAndText(result.stdout, durationMs);

  if (usage !== null) {
    let costUsd: number | undefined;
    try {
      const cacheText = await Deno.readTextFile(
        join(opts.homeDir, ".lazyboy", "anthropic-pricing.json"),
      );
      const pricingCache = JSON.parse(cacheText) as AnthropicPricingCache;
      const cost = calculateAnthropicCost(usage, pricingCache.models);
      if (cost !== null) costUsd = cost;
    } catch {
      // pricing unavailable
    }

    await Deno.writeTextFile(
      join(opts.ticketDir, opts.outputFile.replace(/\.md$/, ".usage.json")),
      JSON.stringify(costUsd !== undefined ? { ...usage, costUsd } : usage),
    );
  }

  const sessionId = opts.agentType === "claude-code"
    ? extractClaudeCodeSessionId(result.stdout)
    : extractSessionId(result.stdout);

  await appendPhaseLog(opts.ticketDir, {
    event: "phase-end",
    phase: opts.phase,
    exitCode: result.code,
    output: result.stderr,
    ...(sessionId !== null ? { sessionId } : {}),
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
      "provider",
      "model",
      "thinking",
      "context-files",
      "agent",
      "session-id",
      "state-dir",
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

  const agentType = (args["agent"] as "pi" | "claude-code" | undefined) ??
    "pi";

  const stateDir = args["state-dir"] ?? "";

  const code = await executePhase(
    {
      ticketDir,
      stateDir,
      outputFile,
      phase,
      scopeDirs,
      prompt,
      worktrees,
      homeDir,
      provider: args["provider"]!,
      model: args["model"]!,
      thinking: args["thinking"]!,
      agentType,
      contextFiles,
      sessionId: args["session-id"] ?? undefined,
    },
    agentType === "claude-code"
      ? new ClaudeCodeAgent(
        join(homeDir, ".lazyboy", "claude-code", "settings.json"),
      )
      : new PiCodeAgent(),
  );
  Deno.exit(code);
}
