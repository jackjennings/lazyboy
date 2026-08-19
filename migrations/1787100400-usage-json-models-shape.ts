import { join } from "@std/path";
import type { StoreMigration } from "../src/migrations/types.ts";

function convertLegacyUsage(obj: Record<string, unknown>): unknown {
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

async function transformDir(dir: string): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      await transformDir(path);
    } else if (entry.isFile && entry.name.endsWith(".usage.json")) {
      const raw = await Deno.readTextFile(path);
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (!Array.isArray(obj.models)) {
        await Deno.writeTextFile(path, JSON.stringify(convertLegacyUsage(obj)));
      }
    }
  }
}

const migration: StoreMigration = {
  type: "store",
  run(stateDir: string): Promise<void> {
    return transformDir(stateDir);
  },
};

export default migration;
