import { assertArrayIncludes, assertEquals, assertRejects } from "@std/assert";
import { createMigrationRunner } from "./runner.ts";
import type { TicketState } from "../state/types.ts";
import type { Migration, StoreMigration } from "./types.ts";

function makeTicket(id: string): TicketState {
  return {
    id,
    provider: "github",
    title: "T",
    url: "u",
    phase: "intake",
    status: "new",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    body: "",
  };
}

Deno.test("createMigrationRunner: no migrations returns tickets unchanged without writes", async () => {
  const writtenTickets: TicketState[] = [];
  const writtenApplied: string[][] = [];
  const runner = createMigrationRunner({
    listMigrationFiles: () => Promise.resolve([]),
    loadMigration: () => Promise.reject(new Error("should not be called")),
    readApplied: () => Promise.resolve([]),
    writeApplied: (_dir, ids) => {
      writtenApplied.push(ids);
      return Promise.resolve();
    },
    writeTicket: (_dir, t) => {
      writtenTickets.push(t);
      return Promise.resolve();
    },
  });
  const tickets = [makeTicket("gh-1"), makeTicket("gh-2")];
  const result = await runner("/state", tickets);
  assertEquals(result, tickets);
  assertEquals(writtenTickets.length, 0);
  assertEquals(writtenApplied.length, 0);
});

Deno.test("createMigrationRunner: one unapplied migration runs against all tickets and writes results", async () => {
  const writtenTickets: TicketState[] = [];
  let writtenApplied: string[] = [];
  const migration: Migration = {
    run: (ticket: TicketState, _stateDir: string) =>
      Promise.resolve({ ...ticket, title: "migrated" }),
  };
  const runner = createMigrationRunner({
    listMigrationFiles: () => Promise.resolve(["1000-add-title.ts"]),
    loadMigration: () => Promise.resolve(migration),
    readApplied: () => Promise.resolve([]),
    writeApplied: (_dir, ids) => {
      writtenApplied = ids;
      return Promise.resolve();
    },
    writeTicket: (_dir, t) => {
      writtenTickets.push(t);
      return Promise.resolve();
    },
  });
  const result = await runner("/state", [
    makeTicket("gh-1"),
    makeTicket("gh-2"),
  ]);
  assertEquals(result.length, 2);
  assertEquals(result[0].title, "migrated");
  assertEquals(result[1].title, "migrated");
  assertEquals(writtenTickets.length, 2);
  assertEquals(writtenApplied, ["1000-add-title.ts"]);
});

Deno.test("createMigrationRunner: already applied migration is not re-applied", async () => {
  let runCount = 0;
  const migration: Migration = {
    run: (ticket: TicketState, _stateDir: string) => {
      runCount++;
      return Promise.resolve(ticket);
    },
  };
  const runner = createMigrationRunner({
    listMigrationFiles: () => Promise.resolve(["1000-add-title.ts"]),
    loadMigration: () => Promise.resolve(migration),
    readApplied: () => Promise.resolve(["1000-add-title.ts"]),
    writeApplied: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
  });
  await runner("/state", [makeTicket("gh-1")]);
  assertEquals(runCount, 0);
});

Deno.test("createMigrationRunner: two migrations run in ascending ID order", async () => {
  const sequence: string[] = [];
  const runner = createMigrationRunner({
    listMigrationFiles: () => Promise.resolve(["1000-a.ts", "2000-b.ts"]),
    loadMigration: (id) =>
      Promise.resolve({
        run: (ticket: TicketState, _stateDir: string) => {
          sequence.push(id);
          return Promise.resolve(ticket);
        },
      }),
    readApplied: () => Promise.resolve([]),
    writeApplied: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
  });
  await runner("/state", [makeTicket("gh-1")]);
  assertEquals(sequence, ["1000-a.ts", "2000-b.ts"]);
});

Deno.test("createMigrationRunner: failing migration re-throws with IDs, no writes", async () => {
  const writtenTickets: TicketState[] = [];
  const writtenApplied: string[][] = [];
  const migration: Migration = {
    run: (_ticket: TicketState, _stateDir: string) =>
      Promise.reject(new Error("bad data")),
  };
  const runner = createMigrationRunner({
    listMigrationFiles: () => Promise.resolve(["1000-fail.ts"]),
    loadMigration: () => Promise.resolve(migration),
    readApplied: () => Promise.resolve([]),
    writeApplied: (_dir, ids) => {
      writtenApplied.push(ids);
      return Promise.resolve();
    },
    writeTicket: (_dir, t) => {
      writtenTickets.push(t);
      return Promise.resolve();
    },
  });
  await assertRejects(
    () => runner("/state", [makeTicket("gh-1")]),
    Error,
    "Migration 1000-fail.ts failed on ticket gh-1: bad data",
  );
  assertEquals(writtenTickets.length, 0);
  assertEquals(writtenApplied.length, 0);
});

Deno.test("createMigrationRunner: absent .migrations file causes all migrations to run", async () => {
  let runCount = 0;
  const migration: Migration = {
    run: (ticket: TicketState, _stateDir: string) => {
      runCount++;
      return Promise.resolve(ticket);
    },
  };
  const runner = createMigrationRunner({
    listMigrationFiles: () =>
      Promise.resolve(["1000-add-title.ts", "2000-rename.ts"]),
    loadMigration: () => Promise.resolve(migration),
    readApplied: () => Promise.resolve([]),
    writeApplied: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
  });
  await runner("/state", [makeTicket("gh-1")]);
  assertEquals(runCount, 2);
});

Deno.test("createMigrationRunner: stateDir is passed to migration.run for each ticket", async () => {
  const capturedStateDirs: string[] = [];
  const migration: Migration = {
    run: (ticket: TicketState, stateDir: string) => {
      capturedStateDirs.push(stateDir);
      return Promise.resolve(ticket);
    },
  };
  const runner = createMigrationRunner({
    listMigrationFiles: () => Promise.resolve(["1000-a.ts"]),
    loadMigration: () => Promise.resolve(migration),
    readApplied: () => Promise.resolve([]),
    writeApplied: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
  });
  await runner("/my-state", [makeTicket("gh-1"), makeTicket("gh-2")]);
  assertEquals(capturedStateDirs, ["/my-state", "/my-state"]);
});

Deno.test("createMigrationRunner: store migration runs once and leaves tickets unchanged", async () => {
  let storeRunCount = 0;
  let capturedStateDir = "";
  const storeMigration: StoreMigration = {
    type: "store",
    run: (stateDir: string) => {
      storeRunCount++;
      capturedStateDir = stateDir;
      return Promise.resolve();
    },
  };
  const runner = createMigrationRunner({
    listMigrationFiles: () => Promise.resolve(["1000-setup-store.ts"]),
    loadMigration: () => Promise.resolve(storeMigration),
    readApplied: () => Promise.resolve([]),
    writeApplied: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
  });
  const tickets = [makeTicket("gh-1"), makeTicket("gh-2")];
  const result = await runner("/state", tickets);
  assertEquals(storeRunCount, 1);
  assertEquals(capturedStateDir, "/state");
  assertEquals(result, tickets);
});

Deno.test("createMigrationRunner: store migration ID written to applied list", async () => {
  let writtenApplied: string[] = [];
  const storeMigration: StoreMigration = {
    type: "store",
    run: () => Promise.resolve(),
  };
  const runner = createMigrationRunner({
    listMigrationFiles: () => Promise.resolve(["1000-setup-store.ts"]),
    loadMigration: () => Promise.resolve(storeMigration),
    readApplied: () => Promise.resolve([]),
    writeApplied: (_dir, ids) => {
      writtenApplied = ids;
      return Promise.resolve();
    },
    writeTicket: () => Promise.resolve(),
  });
  await runner("/state", [makeTicket("gh-1")]);
  assertArrayIncludes(writtenApplied, ["1000-setup-store.ts"]);
});

Deno.test("createMigrationRunner: store and per-ticket migrations run in filename-sort order", async () => {
  const sequence: string[] = [];
  const storeMigration: StoreMigration = {
    type: "store",
    run: () => {
      sequence.push("store");
      return Promise.resolve();
    },
  };
  const ticketMigration: Migration = {
    run: (ticket: TicketState, _stateDir: string) => {
      sequence.push("ticket");
      return Promise.resolve(ticket);
    },
  };
  const migrations: Record<string, Migration | StoreMigration> = {
    "1000-store.ts": storeMigration,
    "2000-ticket.ts": ticketMigration,
  };
  const runner = createMigrationRunner({
    listMigrationFiles: () =>
      Promise.resolve(["1000-store.ts", "2000-ticket.ts"]),
    loadMigration: (id) => Promise.resolve(migrations[id]),
    readApplied: () => Promise.resolve([]),
    writeApplied: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
  });
  await runner("/state", [makeTicket("gh-1")]);
  assertEquals(sequence, ["store", "ticket"]);
});

Deno.test("createMigrationRunner: failing store migration throws with migration ID", async () => {
  const storeMigration: StoreMigration = {
    type: "store",
    run: () => Promise.reject(new Error("disk full")),
  };
  const runner = createMigrationRunner({
    listMigrationFiles: () => Promise.resolve(["1000-bad-store.ts"]),
    loadMigration: () => Promise.resolve(storeMigration),
    readApplied: () => Promise.resolve([]),
    writeApplied: () => Promise.resolve(),
    writeTicket: () => Promise.resolve(),
  });
  await assertRejects(
    () => runner("/state", [makeTicket("gh-1")]),
    Error,
    "Migration 1000-bad-store.ts failed: disk full",
  );
});
