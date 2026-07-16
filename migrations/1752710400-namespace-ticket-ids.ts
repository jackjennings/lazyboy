import { join } from "@std/path";
import type { Migration } from "../src/migrations/types.ts";

const migration: Migration = {
  async run(ticket, stateDir) {
    if (ticket.provider === "github") {
      if (ticket.id.startsWith("github/")) return ticket;
      const match = ticket.url.match(
        /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/,
      );
      if (!match) return ticket;
      const [, org, repo, number] = match;
      const newId = `github/${org}/${repo}/${number}`;
      await Deno.remove(join(stateDir, ticket.id), { recursive: true });
      return { ...ticket, id: newId };
    }
    if (ticket.provider === "jira") {
      if (ticket.id.startsWith("jira/")) return ticket;
      const newId = `jira/${ticket.id.slice("jira-".length)}`;
      await Deno.remove(join(stateDir, ticket.id), { recursive: true });
      return { ...ticket, id: newId };
    }
    return ticket;
  },
};

export default migration;
