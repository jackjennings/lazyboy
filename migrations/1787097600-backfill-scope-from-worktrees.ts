import type { Migration } from "../src/migrations/types.ts";

const migration: Migration = {
  run(ticket) {
    if (ticket.scope.length > 0 || Object.keys(ticket.worktrees).length === 0) {
      return Promise.resolve(ticket);
    }
    return Promise.resolve({
      ...ticket,
      scope: Object.keys(ticket.worktrees),
    });
  },
};

export default migration;
