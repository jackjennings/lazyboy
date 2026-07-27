import type { CodeAgent } from "./types.ts";

export function buildPiArgs(opts: {
  prompt: string;
  model: string;
  thinking: string;
  pathContext: string;
  contextFiles: string[];
  provider?: string;
  sessionId?: string;
}): string[] {
  const args = [
    "--mode",
    "json",
    "--approve",
    "--provider",
    opts.provider ?? "anthropic",
    "--model",
    opts.model,
    "--thinking",
    opts.thinking,
    "--system-prompt",
    opts.prompt + opts.pathContext,
  ];
  if (opts.sessionId !== undefined) {
    args.push("--session-id", opts.sessionId);
  }
  args.push(...opts.contextFiles);
  return args;
}

export class PiCodeAgent implements CodeAgent {
  async runPhase(opts: {
    prompt: string;
    contextFiles: string[];
    cwd: string;
    env: Record<string, string>;
    provider: string;
    model: string;
    thinking: string;
    sessionId?: string;
  }): Promise<{ stdout: string; stderr: string; code: number }> {
    const result = await new Deno.Command("pi", {
      args: buildPiArgs({
        prompt: opts.prompt,
        model: opts.model,
        thinking: opts.thinking,
        pathContext: "",
        contextFiles: opts.contextFiles,
        provider: opts.provider,
        sessionId: opts.sessionId,
      }),
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
