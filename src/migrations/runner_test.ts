import { assertEquals, assertRejects } from "@std/assert";
import { createMigrationRunner } from "./runner.ts";
import type { TicketState } from "../state/types.ts";
import type { Migration } from "./types.ts";

function makeTicket(id: string): TicketState {
  return {
    id,
    provider: "github",
    title: "T",
    url: "u",
    phase: "intake",
    status: "new",
    approved: false,
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
