import { join } from "@std/path";
import type { ActivePhase } from "./types.ts";
import { PHASE_SEQUENCE } from "./types.ts";

const PROMPT_DIR = new URL("./prompts/", import.meta.url).pathname;

export function loadPrompt(phase: ActivePhase): Promise<string> {
  return Deno.readTextFile(join(PROMPT_DIR, `${phase}.md`));
}

export function loadPromptFile(filename: string): Promise<string> {
  return Deno.readTextFile(join(PROMPT_DIR, filename));
}

export function nextPhase(current: ActivePhase): ActivePhase | "done" {
  const idx = PHASE_SEQUENCE.indexOf(current);
  if (idx === -1 || idx === PHASE_SEQUENCE.length - 1) return "done";
  return PHASE_SEQUENCE[idx + 1];
}
