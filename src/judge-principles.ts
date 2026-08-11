import type { CommandRunner } from "./apfel.ts";
import { ApfelLanguageModel } from "./models/apfel.ts";
import { ClaudeLanguageModel } from "./models/claude.ts";
import { FallbackLanguageModel } from "./models/fallback.ts";

const JUDGE_SYSTEM_PROMPT =
  "You are evaluating whether content from an AI coding agent's Principles section contains substantive engineering guidance worth preserving. Reply with verdict KEEP_LOCAL, KEEP_GLOBAL, or SKIP. Default to KEEP_LOCAL unless the principle is about the lazyboy pipeline or tooling itself — not about the specific codebase being modified — in which case use KEEP_GLOBAL. Reply SKIP if the content is meta-commentary explaining why no principles were added, a placeholder, or otherwise lacks actionable engineering guidance.";

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["KEEP_LOCAL", "KEEP_GLOBAL", "SKIP"] },
  },
  required: ["verdict"],
  additionalProperties: false,
};

type Scope = "local" | "global";

export async function judgePrinciples(
  body: string,
  run: CommandRunner,
): Promise<Scope | null> {
  const model = new FallbackLanguageModel([
    new ApfelLanguageModel(run),
    new ClaudeLanguageModel(run, { model: "claude-haiku-4-5" }),
  ]);
  const result = await model.generateObject<
    { verdict: "KEEP_LOCAL" | "KEEP_GLOBAL" | "SKIP" }
  >({
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    prompt: body,
    schema: VERDICT_SCHEMA,
    maxTokens: 64,
  });
  if (result?.verdict === "KEEP_LOCAL") return "local";
  if (result?.verdict === "KEEP_GLOBAL") return "global";
  return null;
}
