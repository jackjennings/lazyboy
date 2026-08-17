import { join } from "@std/path";
import type { ActivePhase } from "./types.ts";
import type { ArtifactType } from "../state/types.ts";
import { PHASE_SEQUENCE } from "./types.ts";
import { readTextFile } from "../filesystem.ts";
import { deriveProjectPath } from "./project-path.ts";

const PROMPT_DIR = new URL("./prompts/", import.meta.url).pathname;

export interface PromptResult {
  content: string;
  partials: string[];
}

async function renderTemplate(content: string): Promise<PromptResult> {
  const markers = [...content.matchAll(/\{\{([a-z][a-z0-9-]*)\}\}/g)];
  if (markers.length === 0) return { content, partials: [] };

  const partialNames = [...new Set(markers.map(([, name]) => name))];
  const partials = new Map<string, string>();
  for (const name of partialNames) {
    const partialPath = join(PROMPT_DIR, "partials", `${name}.md`);
    try {
      partials.set(name, await readTextFile(partialPath));
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new Error(`Unknown partial: {{${name}}}`);
      }
      throw e;
    }
  }

  return {
    content: content.replace(
      /\{\{([a-z][a-z0-9-]*)\}\}/g,
      (_, name) => partials.get(name)!,
    ),
    partials: partialNames,
  };
}

export async function loadPrompt(phase: ActivePhase): Promise<PromptResult> {
  const raw = await readTextFile(join(PROMPT_DIR, `${phase}.md`));
  return renderTemplate(raw);
}

export async function loadPromptFile(filename: string): Promise<PromptResult> {
  const raw = await readTextFile(join(PROMPT_DIR, filename));
  return renderTemplate(raw);
}

export async function loadProviderPrompt(
  phase: string,
  provider: string,
): Promise<PromptResult> {
  try {
    const content = await readTextFile(
      join(PROMPT_DIR, `${provider}-${phase}.md`),
    );
    return renderTemplate(content);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { content: "", partials: [] };
    throw e;
  }
}

export async function loadArtifactPrompt(
  phase: string,
  artifacts: ArtifactType[],
): Promise<PromptResult> {
  const parts: string[] = [];
  const allPartials: string[] = [];
  for (const artifact of artifacts) {
    try {
      const content = await readTextFile(
        join(PROMPT_DIR, `${artifact}-${phase}.md`),
      );
      const result = await renderTemplate(content);
      parts.push(result.content);
      allPartials.push(...result.partials);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  return {
    content: parts.join("\n"),
    partials: [...new Set(allPartials)],
  };
}

export async function loadRevisionPrompt(phase: string): Promise<PromptResult> {
  try {
    const content = await readTextFile(
      join(PROMPT_DIR, `${phase}-revision.md`),
    );
    return renderTemplate(content);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { content: "", partials: [] };
    throw e;
  }
}

async function readPromptFile(path: string): Promise<PromptResult> {
  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { content: "", partials: [] };
    throw e;
  }
  return renderTemplate(raw);
}

export async function loadStatePrompt(
  phase: string,
  stateDir: string,
  provider?: string,
  ticketId?: string,
): Promise<PromptResult> {
  const paths: string[] = [join(stateDir, "prompts", `${phase}.md`)];

  if (provider && ticketId) {
    paths.push(join(stateDir, "prompts", provider, `${phase}.md`));
    const projectPath = deriveProjectPath(provider, ticketId);
    if (projectPath) {
      paths.push(
        join(stateDir, "prompts", provider, projectPath, `${phase}.md`),
      );
    }
  }

  const parts: string[] = [];
  const allPartials: string[] = [];
  for (const path of paths) {
    const result = await readPromptFile(path);
    if (result.content.length > 0) parts.push(result.content);
    allPartials.push(...result.partials);
  }

  return {
    content: parts.join("\n\n"),
    partials: [...new Set(allPartials)],
  };
}

export function nextPhase(current: ActivePhase): ActivePhase | "done" {
  const idx = PHASE_SEQUENCE.indexOf(current);
  if (idx === -1 || idx === PHASE_SEQUENCE.length - 1) return "done";
  return PHASE_SEQUENCE[idx + 1];
}
