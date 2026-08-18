import { join } from "@std/path";
import type { PhaseUsage } from "./state/types.ts";
import { readDir, readTextFile } from "./filesystem.ts";

export function formatLargeTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(Math.round(n / 100) / 10).toFixed(1)}k`;
  return `${(Math.round(n / 100_000) / 10).toFixed(1)}m`;
}

export function coerceLegacyPhaseUsage(raw: unknown): PhaseUsage {
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.models)) {
    return obj as unknown as PhaseUsage;
  }
  const legacy = obj as {
    model: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    durationMs: number;
    turns?: number;
    costUsd?: number;
    tools?: Record<string, number>;
  };
  return {
    durationMs: legacy.durationMs,
    ...(legacy.turns !== undefined ? { turns: legacy.turns } : {}),
    ...(legacy.tools !== undefined ? { tools: legacy.tools } : {}),
    models: [{
      model: legacy.model,
      input: legacy.input,
      output: legacy.output,
      cacheRead: legacy.cacheRead,
      cacheWrite: legacy.cacheWrite,
      ...(legacy.costUsd !== undefined ? { costUsd: legacy.costUsd } : {}),
    }],
  };
}

export async function readUsageFiles(
  ticketDir: string,
): Promise<PhaseUsage[] | null> {
  const files: PhaseUsage[] = [];
  try {
    for await (const entry of readDir(ticketDir)) {
      if (!entry.isFile || !entry.name.endsWith(".usage.json")) continue;
      try {
        const raw = await readTextFile(join(ticketDir, entry.name));
        files.push(coerceLegacyPhaseUsage(JSON.parse(raw)));
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
  return files;
}
