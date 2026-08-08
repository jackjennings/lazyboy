const VALID_MODEL_IDS = new Set([
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
  `Valid model values: "claude-sonnet-4-6", "claude-opus-4-5", "claude-opus-4-6"\n` +
  `Valid thinking values: "off", "minimal", "low", "medium", "high", "xhigh", "max"\n\n` +
  `Guidelines:\n` +
  `- Use "claude-sonnet-4-6" by default. Use "claude-opus-4-6" only for the most demanding tasks.\n` +
  `- Use "high" or "xhigh" for complex multi-file refactors, subtle correctness reasoning, or coordination of many interdependent changes.\n` +
  `- Use "off" or "minimal" for straightforward, well-scoped changes.\n\n` +
  `Respond with only the JSON object and no surrounding prose.`;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    model: { type: "string", enum: [...VALID_MODEL_IDS] },
    thinking: { type: "string", enum: [...VALID_THINKING_LEVELS] },
  },
  required: ["model", "thinking"],
};

export async function adjudicatePhaseModel(
  prompt: string,
): Promise<{ model: string; thinking: string } | null> {
  try {
    const command = new Deno.Command("claude", {
      args: [
        "--print",
        "--bare",
        "--output-format",
        "json",
        "--model",
        "claude-haiku-4-5",
        "--system-prompt",
        SYSTEM_PROMPT,
        "--json-schema",
        JSON.stringify(JSON_SCHEMA),
        prompt,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout } = await command.output();
    if (code !== 0) return null;
    const text = new TextDecoder().decode(stdout);
    const parsed = JSON.parse(text);
    const output = parsed?.structured_output;
    if (
      typeof output?.model !== "string" ||
      typeof output?.thinking !== "string" ||
      !VALID_MODEL_IDS.has(output.model) ||
      !VALID_THINKING_LEVELS.has(output.thinking)
    ) {
      return null;
    }
    return { model: output.model, thinking: output.thinking };
  } catch {
    return null;
  }
}
