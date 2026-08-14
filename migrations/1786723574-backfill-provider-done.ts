import type { Migration } from "../src/migrations/types.ts";

const migration: Migration = {
  run(ticket) {
    if (ticket.providerDone !== undefined) return Promise.resolve(ticket);
    if (ticket.provider !== "jira") return Promise.resolve(ticket);
    if (ticket.phase !== "merge" || ticket.status !== "done") {
      return Promise.resolve(ticket);
    }
    return Promise.resolve({ ...ticket, providerDone: true });
  },
};

export default migration;
