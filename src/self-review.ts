import { join } from "@std/path";
import { findLatestPhaseOutput } from "./review.ts";

const PROMPT_DIR = new URL("./phases/prompts/", import.meta.url).pathname;

export async function selfReview(
  phase: string,
  ticketDir: string,
  fetcher: typeof fetch,
): Promise<boolean> {
  let systemPrompt: string;
  try {
    systemPrompt = await Deno.readTextFile(
      join(PROMPT_DIR, `${phase}-self-review.md`),
    );
  } catch {
    return false;
  }

  const found = await findLatestPhaseOutput(ticketDir);
  if (!found) return false;

  const outputContent = await Deno.readTextFile(
    join(ticketDir, found.filename),
  );

  try {
    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 5,
        system: systemPrompt,
        messages: [{ role: "user", content: outputContent }],
      }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    const result = (data?.content?.[0]?.text ?? "").trim().toUpperCase();
    return result === "APPROVE";
  } catch {
    return false;
  }
}
