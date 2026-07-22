import { adf2markdown } from "adf2markdown";
import type { Migration } from "../src/migrations/types.ts";
import type { TicketState } from "../src/state/types.ts";

const migration: Migration = {
  // deno-lint-ignore require-await
  async run(ticket, _stateDir): Promise<TicketState> {
    if (ticket.provider !== "jira") return ticket;
    if (ticket.body.trim().length === 0) return ticket;

    let parsed: unknown;
    try {
      parsed = JSON.parse(ticket.body);
    } catch {
      return ticket;
    }

    if (
      typeof parsed !== "object" || parsed === null ||
      (parsed as Record<string, unknown>).type !== "doc"
    ) {
      return ticket;
    }

    // deno-lint-ignore no-explicit-any
    const markdown = adf2markdown(parsed as any).trim();
    return { ...ticket, body: markdown };
  },
};

export default migration;
