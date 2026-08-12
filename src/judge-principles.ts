import type { CommandRunner } from "./apfel.ts";
import { ApfelLanguageModel } from "./models/apfel.ts";
import { ClaudeLanguageModel } from "./models/claude.ts";
import { FallbackLanguageModel } from "./models/fallback.ts";

const JUDGE_SYSTEM_PROMPT =
  "You are evaluating whether content from an AI coding agent's Principles section contains substantive engineering guidance worth preserving. Reply with verdict KEEP if the content contains at least one concrete, reusable engineering principle or guideline — a lesson that could inform future engineering decisions. Reply with verdict SKIP if the content is a meta-commentary explaining why no principles were added, a placeholder, or otherwise lacks actionable engineering guidance.";

const VERDICT_SCHEMA = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["KEEP", "SKIP"] } },
  required: ["verdict"],
  additionalProperties: false,
};

export async function judgePrinciples(
  body: string,
  run: CommandRunner,
): Promise<boolean> {
  const model = new FallbackLanguageModel([
    new ApfelLanguageModel(run),
    new ClaudeLanguageModel(run, { model: "claude-haiku-4-5" }),
  ]);
  const result = await model.generateObject<{ verdict: "KEEP" | "SKIP" }>({
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    prompt: body,
    schema: VERDICT_SCHEMA,
    maxTokens: 64,
  });
  return result?.verdict === "KEEP";
}
