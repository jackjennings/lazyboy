import { join } from "@std/path";
import type { Check, CheckResult } from "./types.ts";

export interface UsageSidecarShapeDeps {
  readDir: (path: string) => AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
  }>;
  readTextFile: (path: string) => Promise<string>;
  stateDir: string;
}

async function* walkUsageFiles(
  deps: UsageSidecarShapeDeps,
  dir: string,
): AsyncIterable<string> {
  for await (const entry of deps.readDir(dir)) {
    const entryPath = join(dir, entry.name);
    if (entry.isFile && entry.name.endsWith(".usage.json")) {
      yield entryPath;
    } else if (entry.isDirectory) {
      yield* walkUsageFiles(deps, entryPath);
    }
  }
}

export function usageSidecarShapeCheck(deps: UsageSidecarShapeDeps): Check {
  return {
    id: "usage-sidecar-shape",
    description: "Usage sidecar files match current PhaseUsage shape",
    async run(): Promise<CheckResult> {
      const invalid: string[] = [];

      for await (const filePath of walkUsageFiles(deps, deps.stateDir)) {
        let parsed: unknown;
        try {
          const content = await deps.readTextFile(filePath);
          parsed = JSON.parse(content);
        } catch {
          invalid.push(`${filePath} (JSON parse failed)`);
          continue;
        }

        const obj = parsed as Record<string, unknown>;
        if (typeof obj.durationMs !== "number") {
          invalid.push(`${filePath} (durationMs missing or not a number)`);
          continue;
        }
        if (!Array.isArray(obj.models)) {
          invalid.push(`${filePath} (models is not an array)`);
        }
      }

      if (invalid.length === 0) {
        return { status: "pass", detail: "" };
      }
      return {
        status: "fail",
        detail: `Invalid usage files: ${invalid.join(", ")}`,
        remedy:
          "Corrupt usage files can be deleted — they contain cost tracking data only",
      };
    },
  };
}
