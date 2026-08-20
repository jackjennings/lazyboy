import { dirname } from "@std/path";
import {
  mkdir,
  readTextFile,
  rename,
  writeTextFile,
} from "../../filesystem.ts";

export interface RepoIdentityEntry {
  repoId: number | null;
  currentSlug: string;
  aliases: string[];
  seenBefore?: string;
  blockedBy: number | null;
}

export type RepoIdentityTable = Record<string, RepoIdentityEntry>;

export class CorruptRepoIdentitiesError extends Error {}

export function makeTableIO(filePath: string): {
  readTable: () => Promise<RepoIdentityTable>;
  writeTable: (table: RepoIdentityTable) => Promise<void>;
} {
  return {
    async readTable(): Promise<RepoIdentityTable> {
      let raw: string;
      try {
        raw = await readTextFile(filePath);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return {};
        throw e;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new CorruptRepoIdentitiesError(
          `${filePath} is not valid JSON; repair or remove it by hand`,
        );
      }
      if (
        parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
      ) {
        throw new CorruptRepoIdentitiesError(
          `${filePath} does not hold a repo identity table`,
        );
      }
      return parsed as RepoIdentityTable;
    },
    async writeTable(table: RepoIdentityTable): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
      try {
        await writeTextFile(tmp, `${JSON.stringify(table, null, 2)}\n`);
        await rename(tmp, filePath);
      } catch (e) {
        try {
          await Deno.remove(tmp);
        } catch {
          // tmp may not exist
        }
        throw e;
      }
    },
  };
}

export function canonicalSlugFor(
  table: RepoIdentityTable,
  slug: string,
): string {
  if (table[slug]) return slug;
  for (const [key, entry] of Object.entries(table)) {
    if (entry.aliases.includes(slug)) return key;
  }
  return slug;
}

export function currentSlugFor(
  table: RepoIdentityTable,
  slug: string,
): string {
  const canonical = canonicalSlugFor(table, slug);
  return table[canonical]?.currentSlug ?? slug;
}

export function aliasesFor(table: RepoIdentityTable, slug: string): string[] {
  const canonical = canonicalSlugFor(table, slug);
  return table[canonical]?.aliases ?? [slug];
}
