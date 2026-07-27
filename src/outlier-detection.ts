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
