import { parse } from "@std/toml";
import { join } from "@std/path";
import type { Config } from "./state/types.ts";

export async function loadConfig(path?: string): Promise<Config> {
  const configPath = path ??
    join(Deno.env.get("HOME")!, ".config", "lazyboy", "config.toml");
  const raw = await Deno.readTextFile(configPath);
  const parsed = parse(raw) as Record<string, unknown>;
  const codebaseRaw = parsed.codebase as Record<string, unknown> | undefined;
  const packagesRaw = parsed.packages as Record<string, unknown> | undefined;
  const enabledRaw = packagesRaw?.enabled;
  if (enabledRaw !== undefined && !Array.isArray(enabledRaw)) {
    throw new Error("config.toml: [packages].enabled must be an array");
  }
  return {
    github: {
      repos: (parsed.github as Record<string, unknown>).repos as string[],
    },
    state: {
      dir: expandHome((parsed.state as Record<string, unknown>).dir as string),
    },
    tick: {
      concurrency:
        ((parsed.tick as Record<string, unknown>).concurrency as number) ?? 1,
    },
    codebase: { roots: (codebaseRaw?.roots as string[]) ?? [] },
    packages: { enabled: (enabledRaw as string[] | undefined) ?? [] },
  };
}

export function expandHome(p: string): string {
  return p.startsWith("~/") ? join(Deno.env.get("HOME")!, p.slice(2)) : p;
}
