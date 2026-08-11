import type { CommandRunner } from "./apfel.ts";

const JUDGE_SYSTEM_PROMPT =
  "You are evaluating whether content from an AI coding agent's Principles section contains substantive engineering guidance worth preserving. Reply with exactly KEEP if the content contains at least one concrete, reusable engineering principle or guideline — a lesson that could inform future engineering decisions. Reply with exactly SKIP if the content is a meta-commentary explaining why no principles were added, a placeholder, or otherwise lacks actionable engineering guidance.";

export async function judgePrinciples(
  body: string,
  run: CommandRunner,
): Promise<boolean> {
  try {
    const { code, stdout } = await run([
      "apfel",
      "--quiet",
      "--max-tokens",
      "5",
      "-s",
      JUDGE_SYSTEM_PROMPT,
      body,
    ]);
    if (code === 0) {
      return stdout.trim().split(/\s/)[0].toUpperCase() === "KEEP";
    }
  } catch {
    // apfel unavailable — fall through to claude CLI
  }
  try {
    const { code, stdout } = await run([
      "claude",
      body,
      "--print",
      "--output-format",
      "text",
      "--system-prompt",
      JUDGE_SYSTEM_PROMPT,
      "--model",
      "claude-haiku-4-5",
      "--tools",
      "",
    ]);
    if (code !== 0) return false;
    return stdout.trim().split(/\s/)[0].toUpperCase() === "KEEP";
  } catch {
    return false;
  }
}
