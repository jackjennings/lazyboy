import type { CommandRunner } from "./apfel.ts";

const SHORT_TITLE_SYSTEM_PROMPT =
  "Compress this title to a short 2–6 word label that remains identifiable at a glance. Prefer noun phrases. Use more words if necessary to avoid dropping important context. Use title case. Output only the short title.";

export async function generateShortTitle(
  run: CommandRunner,
  title: string,
): Promise<string | null> {
  try {
    const { code, stdout } = await run([
      "apfel",
      "--quiet",
      "--max-tokens",
      "40",
      "-s",
      SHORT_TITLE_SYSTEM_PROMPT,
      title,
    ]);
    if (code !== 0) return null;
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
