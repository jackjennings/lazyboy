import { join } from "@std/path";
import { compactTimestamp } from "../src/timestamp.ts";
import { runGit } from "../src/worktree.ts";
import type { Migration } from "../src/migrations/types.ts";

const PHASES = [
  "intake",
  "enrichment",
  "spec",
  "plan",
  "implementation",
] as const;

const migration: Migration = {
  async run(ticket, stateDir) {
    const ticketDir = join(stateDir, ticket.id);
    const entries: Deno.DirEntry[] = [];
    try {
      for await (const entry of Deno.readDir(ticketDir)) {
        entries.push(entry);
      }
    } catch {
      return ticket;
    }

    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const name = entry.name;

      if (/^\d{8}T\d{6}/.test(name)) continue;

      const oldPath = join(ticketDir, name);
      let newName: string | null = null;

      for (const phase of PHASES) {
        if (name === `${phase}.md`) {
          const { stdout } = await runGit(
            [
              "log",
              "--diff-filter=A",
              "--format=%ct",
              "--",
              `${ticket.id}/${name}`,
            ],
            stateDir,
          );
          const ct = parseInt(stdout.trim());
          let ts: string;
          if (!isNaN(ct) && ct > 0) {
            ts = compactTimestamp(
              Temporal.Instant.fromEpochMilliseconds(ct * 1000)
                .toZonedDateTimeISO("UTC"),
            );
          } else {
            const stat = await Deno.stat(oldPath);
            const ms = stat.mtime?.getTime() ?? Date.now();
            ts = compactTimestamp(
              Temporal.Instant.fromEpochMilliseconds(ms)
                .toZonedDateTimeISO("UTC"),
            );
          }
          newName = `${ts}-${phase}.md`;
          break;
        }

        const revMatch = name.match(
          new RegExp(`^${phase}-(\\d{8}T\\d{6})\\.md$`),
        );
        if (revMatch) {
          newName = `${revMatch[1]}-${phase}.md`;
          break;
        }

        const fbMatch = name.match(
          new RegExp(
            `^${phase}-feedback-(\\d{4})-(\\d{2})-(\\d{2})T(\\d{6})\\.md$`,
          ),
        );
        if (fbMatch) {
          newName = `${fbMatch[1]}${fbMatch[2]}${fbMatch[3]}T${
            fbMatch[4]
          }-${phase}-feedback.md`;
          break;
        }
      }

      if (newName && newName !== name) {
        await Deno.rename(oldPath, join(ticketDir, newName));
      }
    }

    return ticket;
  },
};

export default migration;
