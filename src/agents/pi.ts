import type { CodeAgent } from "./types.ts";

export function buildPiArgs(
  prompt: string,
  model: string,
  thinking: string,
  pathContext: string,
  contextFiles: string[],
  provider = "anthropic",
): string[] {
  return [
    "--mode",
    "json",
    "--approve",
    "--provider",
    provider,
    "--model",
    model,
    "--thinking",
    thinking,
    "--system-prompt",
    prompt + pathContext,
    ...contextFiles,
  ];
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
  }): Promise<{ stdout: string; stderr: string; code: number }> {
    const result = await new Deno.Command("pi", {
      args: buildPiArgs(
        opts.prompt,
        opts.model,
        opts.thinking,
        "",
        opts.contextFiles,
        opts.provider,
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
