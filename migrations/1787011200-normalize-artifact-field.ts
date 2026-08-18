import type { Migration } from "../src/migrations/types.ts";

const migration: Migration = {
  run(ticket) {
    return Promise.resolve(ticket);
  },
};

export default migration;
