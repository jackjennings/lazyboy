import type { CommandRunner } from "./apfel.ts";

const CONTEXT_CHAR_BUDGET = 12000;

const SHORT_TITLE_SYSTEM_PROMPT =
  `Compress the title to a short 2–6 word label that stays identifiable at a glance. Prefer noun or verb phrases that mirror the title's intent.

Rules:
- Use Title Case. Never ALL CAPS, never all lowercase.
- No trailing punctuation.
- Keep specific identifiers (issue numbers, repo/file/flag names, proper nouns). Do not generalize into a vague summary.
- Preserve the action, not just the topic.
- The optional context is only to disambiguate the title; compress the title, do not summarize the context.
- Output only the short title, nothing else.

Examples:
Title: Migrate tick scheduler from cron to a LaunchAgent to fix recurring TCC prompts
Short: Migrate Tick Scheduler to LaunchAgent

Title: Clamp the implementation phase to a minimum model floor
Short: Clamp Implementation Model Floor

Title: Fix CI failure on github/jackjennings/lazyboy/276
Short: Fix CI Failure on Lazyboy #276

Title: Kill process when declining work
Short: Kill Process on Decline

Title: Fix slow test suite
Short: Fix Slow Test Suite`;

export async function generateShortTitle(
  run: CommandRunner,
  title: string,
  context?: string,
): Promise<string | null> {
  try {
    const trimmedContext = context?.trim();
    const userPrompt = trimmedContext
      ? `Title: ${title}\n\nContext:\n${
        trimmedContext.slice(0, CONTEXT_CHAR_BUDGET)
      }`
      : title;
    const { code, stdout } = await run([
      "apfel",
      "--quiet",
      "--max-tokens",
      "40",
      "-s",
      SHORT_TITLE_SYSTEM_PROMPT,
      userPrompt,
    ]);
    if (code !== 0) return null;
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
