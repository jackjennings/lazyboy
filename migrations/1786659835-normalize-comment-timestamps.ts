import type { Migration } from "../src/migrations/types.ts";

const migration: Migration = {
  run(ticket, _stateDir) {
    if (ticket.lastSeenCommentTimestamp === undefined) {
      return Promise.resolve(ticket);
    }
    try {
      return Promise.resolve({
        ...ticket,
        lastSeenCommentTimestamp: Temporal.Instant.from(
          ticket.lastSeenCommentTimestamp,
        ).toString(),
      });
    } catch {
      return Promise.resolve(ticket);
    }
  },
};

export default migration;
