import { join } from "@std/path";
import { stat } from "../filesystem.ts";

interface ToolRequirement {
  binary: string;
  envVar: string;
}

export const TOOL_REQUIREMENTS: Record<string, ToolRequirement> = {
  "notion": { binary: "notion-fetch", envVar: "NOTION_TOKEN" },
};

export async function checkToolAvailability(
  partialNames: string[],
  effectivePath: string,
  env: Record<string, string>,
): Promise<
  | { ok: true }
  | { ok: false; tool: string; missing: "binary" | "env-var"; name: string }
> {
  for (const partialName of partialNames) {
    const req = TOOL_REQUIREMENTS[partialName];
    if (req === undefined) continue;

    const pathSegments = effectivePath.split(":");
    let binaryFound = false;
    for (const segment of pathSegments) {
      try {
        const info = await stat(join(segment, req.binary));
        if (info.isFile) {
          binaryFound = true;
          break;
        }
      } catch {
        // not found in this segment
      }
    }
    if (!binaryFound) {
      return {
        ok: false,
        tool: partialName,
        missing: "binary",
        name: req.binary,
      };
    }

    const envValue = env[req.envVar];
    if (!envValue) {
      return {
        ok: false,
        tool: partialName,
        missing: "env-var",
        name: req.envVar,
      };
    }
  }
  return { ok: true };
}
