import { join } from "@std/path";

export async function detectImplementationOutlier(
  ticketDir: string,
): Promise<{ turns: number; taskCount: number } | null> {
  const planFiles: string[] = [];
  const usageFiles: string[] = [];
  try {
    for await (const entry of Deno.readDir(ticketDir)) {
      if (entry.isFile && /^\d{8}T\d{6}-plan\.md$/.test(entry.name)) {
        planFiles.push(entry.name);
      }
      if (
        entry.isFile &&
        /^\d{8}T\d{6}-implementation\.usage\.json$/.test(entry.name)
      ) {
        usageFiles.push(entry.name);
      }
    }
  } catch {
    return null;
  }
  if (planFiles.length === 0 || usageFiles.length === 0) return null;
  planFiles.sort();
  usageFiles.sort();

  let planContent: string;
  let usageContent: string;
  try {
    planContent = await Deno.readTextFile(
      join(ticketDir, planFiles[planFiles.length - 1]),
    );
    usageContent = await Deno.readTextFile(
      join(ticketDir, usageFiles[usageFiles.length - 1]),
    );
  } catch {
    return null;
  }

  let usage: { turns?: unknown };
  try {
    usage = JSON.parse(usageContent);
  } catch {
    return null;
  }
  if (typeof usage.turns !== "number") return null;

  const taskCount = (planContent.match(/^#{2,3} Task/gim) ?? []).length;
  if (taskCount === 0) return null;

  const { turns } = usage as { turns: number };
  if (turns <= 5 * taskCount) return null;

  return { turns, taskCount };
}

export async function detectPlanOutlier(
  ticketDir: string,
): Promise<{ turns: number; criterionCount: number } | null> {
  const specFiles: string[] = [];
  const usageFiles: string[] = [];
  try {
    for await (const entry of Deno.readDir(ticketDir)) {
      if (entry.isFile && /^\d{8}T\d{6}-spec\.md$/.test(entry.name)) {
        specFiles.push(entry.name);
      }
      if (
        entry.isFile &&
        /^\d{8}T\d{6}-plan\.usage\.json$/.test(entry.name)
      ) {
        usageFiles.push(entry.name);
      }
    }
  } catch {
    return null;
  }
  if (specFiles.length === 0 || usageFiles.length === 0) return null;
  specFiles.sort();
  usageFiles.sort();

  let specContent: string;
  let usageContent: string;
  try {
    specContent = await Deno.readTextFile(
      join(ticketDir, specFiles[specFiles.length - 1]),
    );
    usageContent = await Deno.readTextFile(
      join(ticketDir, usageFiles[usageFiles.length - 1]),
    );
  } catch {
    return null;
  }

  let usage: { turns?: unknown };
  try {
    usage = JSON.parse(usageContent);
  } catch {
    return null;
  }
  if (typeof usage.turns !== "number") return null;

  const criterionCount = (specContent.match(/^### /gim) ?? []).length;
  if (criterionCount === 0) return null;

  const { turns } = usage as { turns: number };
  if (turns <= 5 * criterionCount) return null;

  return { turns, criterionCount };
}
