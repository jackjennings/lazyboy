import { join } from "@std/path";
import type { StoreMigration } from "../src/migrations/types.ts";
import { coerceLegacyPhaseUsage } from "../src/usage.ts";

async function transformDir(dir: string): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      await transformDir(path);
    } else if (entry.isFile && entry.name.endsWith(".usage.json")) {
      const raw = await Deno.readTextFile(path);
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (!Array.isArray(obj.models)) {
        const coerced = coerceLegacyPhaseUsage(obj);
        await Deno.writeTextFile(path, JSON.stringify(coerced));
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
