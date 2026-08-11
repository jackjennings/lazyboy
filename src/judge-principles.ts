import type { CommandRunner } from "./apfel.ts";

const JUDGE_SYSTEM_PROMPT =
  "You are evaluating whether content from an AI coding agent's Principles section contains substantive engineering guidance worth preserving. Reply with verdict KEEP if the content contains at least one concrete, reusable engineering principle or guideline — a lesson that could inform future engineering decisions. Reply with verdict SKIP if the content is a meta-commentary explaining why no principles were added, a placeholder, or otherwise lacks actionable engineering guidance.";

const VERDICT_SCHEMA = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["KEEP", "SKIP"] } },
  required: ["verdict"],
  additionalProperties: false,
};

function parseVerdict(stdout: string): boolean | null {
  try {
    const parsed = JSON.parse(stdout.trim()) as { verdict?: unknown };
    if (parsed.verdict === "KEEP") return true;
    if (parsed.verdict === "SKIP") return false;
    return null;
  } catch {
    return null;
  }
}

async function judgeWithApfel(
  body: string,
  run: CommandRunner,
): Promise<boolean | null> {
  let schemaPath: string;
  try {
    schemaPath = await Deno.makeTempFile({ suffix: ".json" });
    await Deno.writeTextFile(schemaPath, JSON.stringify(VERDICT_SCHEMA));
  } catch {
    return null;
  }
  try {
    const { code, stdout } = await run([
      "apfel",
      "--quiet",
      "--max-tokens",
      "64",
      "--schema",
      schemaPath,
      "-s",
      JUDGE_SYSTEM_PROMPT,
      "--",
      body,
    ]);
    return code === 0 ? parseVerdict(stdout) : null;
  } catch {
    return null;
  } finally {
    try {
      await Deno.remove(schemaPath);
    } catch {
      // temp file already gone
    }
  }
}

async function judgeWithClaude(
  body: string,
  run: CommandRunner,
): Promise<boolean | null> {
  try {
    const { code, stdout } = await run([
      "claude",
      "--print",
      "--output-format",
      "text",
      "--system-prompt",
      JUDGE_SYSTEM_PROMPT,
      "--model",
      "claude-haiku-4-5",
      "--tools",
      "",
      "--json-schema",
      JSON.stringify(VERDICT_SCHEMA),
      "--",
      body,
    ]);
    return code === 0 ? parseVerdict(stdout) : null;
  } catch {
    return null;
  }
}

export async function judgePrinciples(
  body: string,
  run: CommandRunner,
): Promise<boolean> {
  const local = await judgeWithApfel(body, run);
  if (local !== null) return local;
  return await judgeWithClaude(body, run) ?? false;
}
