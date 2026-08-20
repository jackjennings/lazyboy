import { join } from "@std/path";
import type { StoreMigration } from "../src/migrations/types.ts";
import {
  makeTableIO,
  type RepoIdentityTable,
} from "../src/providers/github/repo-identity.ts";
import { readDir, readTextFile } from "../src/filesystem.ts";

function parseFrontmatterCreated(content: string): string | null {
  const match = content.match(/^created:\s+'([^']+)'/m);
  return match?.[1] ?? null;
}

const migration: StoreMigration = {
  type: "store",
  async run(stateDir: string): Promise<void> {
    const bySlug = new Map<string, string[]>();

    try {
      for await (const providerEntry of readDir(stateDir)) {
        if (!providerEntry.isDirectory || providerEntry.name !== "github") {
          continue;
        }
        const githubDir = join(stateDir, "github");
        for await (const orgEntry of readDir(githubDir)) {
          if (!orgEntry.isDirectory) continue;
          const orgDir = join(githubDir, orgEntry.name);
          for await (const repoEntry of readDir(orgDir)) {
            if (!repoEntry.isDirectory) continue;
            const slug = `${orgEntry.name}/${repoEntry.name}`;
            const repoDir = join(orgDir, repoEntry.name);
            for await (const ticketEntry of readDir(repoDir)) {
              if (!ticketEntry.isDirectory) continue;
              try {
                const meta = await readTextFile(
                  join(repoDir, ticketEntry.name, "meta.md"),
                );
                const created = parseFrontmatterCreated(meta);
                if (created) {
                  const existing = bySlug.get(slug) ?? [];
                  bySlug.set(slug, [...existing, created]);
                }
              } catch {
                // unreadable ticket — skip
              }
            }
          }
        }
      }
    } catch {
      // stateDir missing or unreadable
    }

    if (bySlug.size === 0) return;

    const table: RepoIdentityTable = {};
    for (const [slug, timestamps] of bySlug) {
      timestamps.sort();
      table[slug] = {
        repoId: null,
        currentSlug: slug,
        aliases: [slug],
        seenBefore: timestamps[0],
        blockedBy: null,
      };
    }

    const { writeTable } = makeTableIO(join(stateDir, "repos.json"));
    await writeTable(table);
  },
};

export default migration;
