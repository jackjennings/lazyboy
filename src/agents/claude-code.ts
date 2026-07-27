import type { CodeAgent } from "./types.ts";

const EFFORT_LEVELS: Record<string, string | undefined> = {
  off: undefined,
  minimal: undefined,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

function stripAtPrefix(f: string): string {
  return f.startsWith("@") ? f.slice(1) : f;
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "" : path.slice(0, idx);
}

export function deriveAddDirs(
  contextFiles: string[],
  cwd: string,
): string[] {
  const dirs = new Set<string>();
  for (const f of contextFiles) {
    const dir = parentDir(stripAtPrefix(f));
    if (dir === "" || dir === cwd || dir.startsWith(cwd + "/")) continue;
    dirs.add(dir);
  }
  return [...dirs].sort();
}

export function buildClaudeCodeArgs(
  prompt: string,
  model: string,
  thinking: string,
  contextFiles: string[],
  cwd: string,
  settingsPath: string,
): string[] {
  const fileList = contextFiles.length > 0
    ? "\n\nRead these files first:\n" +
      contextFiles.map((f) => `- ${stripAtPrefix(f)}`).join("\n")
    : "";
  const fullPrompt = prompt + fileList;

  const args = [
    fullPrompt,
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--setting-sources",
    "project,local",
    "--settings",
    settingsPath,
    "--model",
    model,
  ];

  const effort = EFFORT_LEVELS[thinking];
  if (effort !== undefined) {
    args.push("--effort", effort);
  }

  const addDirs = deriveAddDirs(contextFiles, cwd);
  if (addDirs.length > 0) {
    args.push("--add-dir", ...addDirs);
  }

  return args;
}

export class ClaudeCodeAgent implements CodeAgent {
  constructor(private settingsPath: string) {}

  async runPhase(opts: {
    prompt: string;
    contextFiles: string[];
    cwd: string;
    env: Record<string, string>;
    provider: string;
    model: string;
    thinking: string;
  }): Promise<{ stdout: string; stderr: string; code: number }> {
    const result = await new Deno.Command("claude", {
      args: buildClaudeCodeArgs(
        opts.prompt,
        opts.model,
        opts.thinking,
        opts.contextFiles,
        opts.cwd,
        this.settingsPath,
      ),
      cwd: opts.cwd,
      env: opts.env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decode = (b: Uint8Array) => new TextDecoder().decode(b);
    return {
      stdout: decode(result.stdout),
      stderr: decode(result.stderr),
      code: result.code,
    };
  }
}
