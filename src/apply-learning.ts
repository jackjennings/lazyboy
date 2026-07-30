const SYSTEM_PROMPT =
  `You are integrating a single learning into an existing Markdown document (a coding-agent prompt).

You are given the current document and a description of what should be added or clarified. Merge the learning into the document at the most appropriate location: extend the relevant section, or add a new instruction where similar instructions already live. Preserve everything else verbatim — do not rewrite unrelated prose, reorder sections, or drop content. If the learning is already expressed in the document, return it unchanged.

Return the complete updated document wrapped in <updated-file> and </updated-file> tags, with no other commentary.`;

function extractDocument(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const open = trimmed.indexOf("<updated-file>");
  const close = trimmed.lastIndexOf("</updated-file>");
  const inner = open !== -1 && close !== -1 && close > open
    ? trimmed.slice(open + "<updated-file>".length, close).trim()
    : trimmed;
  return `${inner}\n`;
}

export async function applyLearning(
  currentContent: string,
  intent: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  const userMessage =
    `## Learning to integrate\n\n${intent}\n\n## Current document\n\n${currentContent}`;
  try {
    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16384,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.content?.[0]?.text ?? "";
    return extractDocument(text);
  } catch {
    return null;
  }
}
