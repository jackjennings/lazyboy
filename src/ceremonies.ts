import { join } from "@std/path";
import type { Ceremony } from "./ceremonies/types.ts";

export type { Ceremony } from "./ceremonies/types.ts";

export interface CeremonyRunnerDeps {
  stateDir: string;
}

export class CeremonyRunner {
  readonly #deps: CeremonyRunnerDeps;
  readonly #ceremonies: Map<string, Ceremony>;

  constructor(deps: CeremonyRunnerDeps, ceremonies: Ceremony[]) {
    this.#deps = deps;
    this.#ceremonies = new Map(ceremonies.map((c) => [c.name, c]));
  }

  async run(): Promise<void> {
    const ceremoniesDir = join(this.#deps.stateDir, "ceremonies");
    const dirEntries: Deno.DirEntry[] = [];
    try {
      for await (const entry of Deno.readDir(ceremoniesDir)) {
        dirEntries.push(entry);
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return;
      throw e;
    }
    for (const entry of dirEntries) {
      if (!entry.isDirectory) continue;
      const ceremony = this.#ceremonies.get(entry.name);
      if (!ceremony) continue;
      await ceremony.run();
    }
  }
}
