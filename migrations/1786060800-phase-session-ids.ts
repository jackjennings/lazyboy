import { join } from "@std/path";
import type { Migration } from "../src/migrations/types.ts";

const PHASE_TIMESTAMP_PREFIX = /^\d{8}T\d{6}-/;

function phaseNameFromEntry(raw: string): string | null {
  return PHASE_TIMESTAMP_PREFIX.test(raw)
    ? raw.replace(PHASE_TIMESTAMP_PREFIX, "")
    : null;
}

interface LogEntry {
  event?: string;
  phase?: string;
  sessionId?: string;
}

const migration: Migration = {
  async run(ticket, stateDir) {
    if (ticket.phaseSessionIds !== undefined) return ticket;

    const logPath = join(stateDir, ticket.id, "log.ndjson");
    let raw: string;
    try {
      raw = await Deno.readTextFile(logPath);
    } catch {
      return ticket;
    }

    const entries: LogEntry[] = [];
    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // skip malformed
      }
    }

    const phaseSessionIds: Record<string, string> = {};

    for (const entry of entries) {
      if (
        entry.event === "phase-end" &&
        typeof entry.phase === "string" &&
        typeof entry.sessionId === "string" &&
        entry.sessionId.length > 0
      ) {
        const phaseName = phaseNameFromEntry(entry.phase);
        if (phaseName) {
          phaseSessionIds[phaseName] = entry.sessionId;
        }
      }
      if (entry.event === "conflict-resolution-started") {
        delete phaseSessionIds["implementation"];
      }
    }

    if (Object.keys(phaseSessionIds).length === 0) return ticket;
    return { ...ticket, phaseSessionIds };
  },
};

export default migration;
