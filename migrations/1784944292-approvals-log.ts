import matter from "gray-matter";
import { join } from "@std/path";
import type { Migration } from "../src/migrations/types.ts";
import type { ApprovalEntry } from "../src/state/types.ts";

const migration: Migration = {
  async run(ticket, stateDir) {
    if (ticket.approvals !== undefined) return ticket;

    const metaPath = join(stateDir, ticket.id, "meta.md");
    let raw: string;
    try {
      raw = await Deno.readTextFile(metaPath);
    } catch {
      return { ...ticket, approvals: [] };
    }

    const { data } = matter(raw);
    const wasApproved = data.approved as boolean | undefined;

    if (!wasApproved) {
      return { ...ticket, approvals: [] };
    }

    const entry: ApprovalEntry = {
      timestamp: ticket.updated,
      actor: "unknown",
      phase: ticket.phase,
    };
    return { ...ticket, approvals: [entry] };
  },
};

export default migration;
