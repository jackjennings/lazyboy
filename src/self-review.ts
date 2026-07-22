import { join } from "@std/path";
import { findLatestPhaseOutput } from "./review.ts";

const PROMPT_DIR = new URL("./phases/prompts/", import.meta.url).pathname;

export async function selfReview(
  phase: string,
  ticketDir: string,
  fetcher: typeof fetch,
): Promise<{ approved: boolean; reason: string | null }> {
  let systemPrompt: string;
  try {
    systemPrompt = await Deno.readTextFile(
      join(PROMPT_DIR, `${phase}-self-review.md`),
    );
  } catch {
    return { approved: false, reason: null };
  }

  const found = await findLatestPhaseOutput(ticketDir);
  if (!found) return { approved: false, reason: null };

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
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: "user", content: outputContent }],
      }),
    });
    if (!response.ok) return { approved: false, reason: null };
    const data = await response.json();
    const text = (data?.content?.[0]?.text ?? "").trim();
    const firstLine = text.split("\n")[0].trim().toUpperCase();
    if (firstLine === "APPROVE") return { approved: true, reason: null };
    return { approved: false, reason: text.length > 0 ? text : null };
  } catch {
    return { approved: false, reason: null };
  }
}
