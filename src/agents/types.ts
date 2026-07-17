export interface CodeAgent {
  runPhase(opts: {
    prompt: string;
    contextFiles: string[];
    cwd: string;
    env: Record<string, string>;
    provider: string;
    model: string;
    thinking: string;
  }): Promise<{ stdout: string; stderr: string; code: number }>;
}
