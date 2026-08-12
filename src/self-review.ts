import { join } from "@std/path";
import { findLatestPhaseOutput } from "./review.ts";
import type { CommandRunner } from "./apfel.ts";
import { readTextFile } from "./filesystem.ts";
import { ClaudeLanguageModel } from "./models/claude.ts";

const PROMPT_DIR = new URL("./phases/prompts/", import.meta.url).pathname;

export async function selfReview(
  phase: string,
  ticketDir: string,
  run: CommandRunner,
): Promise<{ approved: boolean; reason: string | null }> {
  let systemPrompt: string;
  try {
    systemPrompt = await readTextFile(
      join(PROMPT_DIR, `${phase}-self-review.md`),
    );
  } catch {
    return { approved: false, reason: null };
  }

  const found = await findLatestPhaseOutput(ticketDir);
  if (!found) return { approved: false, reason: null };

  const outputContent = await readTextFile(
    join(ticketDir, found.filename),
  );

  const model = new ClaudeLanguageModel(run, { model: "claude-haiku-4-5" });
  const text = await model.generateText({
    systemPrompt: systemPrompt,
    prompt: outputContent,
  });
  if (text == null) return { approved: false, reason: null };
  const firstLine = text.split("\n")[0].trim().toUpperCase();
  if (firstLine === "APPROVE") return { approved: true, reason: null };
  return { approved: false, reason: text.length > 0 ? text : null };
}
