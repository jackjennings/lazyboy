const VALID_MODEL_IDS = new Set([
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-opus-4-6",
]);

const VALID_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const SYSTEM_PROMPT =
  `You are selecting the model and thinking level for an implementation phase agent. ` +
  `Given the implementation prompt below, return a JSON object with exactly two fields: "model" and "thinking".\n\n` +
  `Valid model values: "claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-5", "claude-opus-4-6"\n` +
  `Valid thinking values: "off", "minimal", "low", "medium", "high", "xhigh", "max"\n\n` +
  `Guidelines:\n` +
  `- Use "claude-sonnet-4-6" by default. Use "claude-opus-4-6" only for the most demanding tasks.\n` +
  `- Use "high" or "xhigh" for complex multi-file refactors, subtle correctness reasoning, or coordination of many interdependent changes.\n` +
  `- Use "off" or "minimal" for straightforward, well-scoped changes.\n\n` +
  `Respond with only the JSON object and no surrounding prose.`;

export async function adjudicatePhaseModel(
  prompt: string,
  fetcher: typeof fetch,
  apiKey: string,
): Promise<{ model: string; thinking: string } | null> {
  try {
    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 100,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = (data?.content?.[0]?.text ?? "").trim();
    const parsed = JSON.parse(text);
    if (
      typeof parsed.model !== "string" ||
      typeof parsed.thinking !== "string" ||
      !VALID_MODEL_IDS.has(parsed.model) ||
      !VALID_THINKING_LEVELS.has(parsed.thinking)
    ) {
      return null;
    }
    return { model: parsed.model, thinking: parsed.thinking };
  } catch {
    return null;
  }
}
