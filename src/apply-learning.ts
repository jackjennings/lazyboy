import type { CommandRunner } from "./apfel.ts";

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
  run: CommandRunner,
): Promise<string | null> {
  const userMessage =
    `## Learning to integrate\n\n${intent}\n\n## Current document\n\n${currentContent}`;
  try {
    const { code, stdout } = await run([
      "claude",
      userMessage,
      "--print",
      "--output-format",
      "text",
      "--system-prompt",
      SYSTEM_PROMPT,
      "--model",
      "claude-sonnet-4-6",
      "--tools",
      "",
    ]);
    if (code !== 0) return null;
    return extractDocument(stdout);
  } catch {
    return null;
  }
}
