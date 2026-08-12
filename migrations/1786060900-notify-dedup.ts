import { join } from "@std/path";
import type { Migration } from "../src/migrations/types.ts";
import { readTextFile } from "../src/filesystem.ts";

const migration: Migration = {
  async run(ticket, stateDir) {
    if (ticket.notifiedNeedsAttention !== undefined) return ticket;
    if (ticket.status !== "needs-attention") return ticket;

    const logPath = join(stateDir, ticket.id, "log.ndjson");
    let raw: string;
    try {
      raw = await readTextFile(logPath);
    } catch {
      return ticket;
    }

    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        const entry = JSON.parse(line) as { event?: string };
        if (entry.event === "notified-needs-attention") {
          return { ...ticket, notifiedNeedsAttention: true };
        }
      } catch {
        // skip malformed
      }
    }

    return ticket;
  },
};

export default migration;
