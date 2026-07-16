import type { CodeAgent } from "./types.ts";

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
      args: [
        "--mode",
        "json",
        "--approve",
        "--provider",
        opts.provider,
        "--model",
        opts.model,
        "--thinking",
        opts.thinking,
        "--system-prompt",
        opts.prompt,
        ...opts.contextFiles,
      ],
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
