import { dirname, join } from "@std/path";
import type { Migration } from "../src/migrations/types.ts";

async function renameTicketDir(
  stateDir: string,
  oldId: string,
  newId: string,
) {
  const newPath = join(stateDir, newId);
  await Deno.mkdir(dirname(newPath), { recursive: true });
  await Deno.rename(join(stateDir, oldId), newPath);
}

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
      await renameTicketDir(stateDir, ticket.id, newId);
      return { ...ticket, id: newId };
    }
    if (ticket.provider === "jira") {
      if (ticket.id.startsWith("jira/")) return ticket;
      const newId = `jira/${ticket.id.slice("jira-".length)}`;
      await renameTicketDir(stateDir, ticket.id, newId);
      return { ...ticket, id: newId };
    }
    return ticket;
  },
};

export default migration;
