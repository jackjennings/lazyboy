import { join } from "@std/path";
import type { PhaseUsage } from "./state/types.ts";

export function formatLargeTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(Math.round(n / 100) / 10).toFixed(1)}k`;
  return `${(Math.round(n / 100_000) / 10).toFixed(1)}m`;
}

export async function readUsageFiles(
  ticketDir: string,
): Promise<PhaseUsage[] | null> {
  const files: PhaseUsage[] = [];
  try {
    for await (const entry of Deno.readDir(ticketDir)) {
      if (!entry.isFile || !entry.name.endsWith(".usage.json")) continue;
      try {
        const raw = await Deno.readTextFile(join(ticketDir, entry.name));
        files.push(JSON.parse(raw) as PhaseUsage);
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
  return files;
}
