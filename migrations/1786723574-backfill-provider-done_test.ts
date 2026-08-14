import { assert, assertEquals, assertFalse } from "@std/assert";
import migration from "./1786723574-backfill-provider-done.ts";
import { makeTicket } from "../src/test-support.ts";

const STATE_DIR = "/tmp/unused";

Deno.test("migration backfill-provider-done: jira ticket at merge/done is marked done", async () => {
  const ticket = makeTicket({
    id: "jira/NW-1762",
    provider: "jira",
    phase: "merge",
    status: "done",
  });
  const result = await migration.run(ticket, STATE_DIR);
  assert(result.providerDone);
});

Deno.test("migration backfill-provider-done: jira ticket still in progress is left alone", async () => {
  const ticket = makeTicket({
    id: "jira/NW-1843",
    provider: "jira",
    phase: "implementation",
    status: "waiting",
  });
  const result = await migration.run(ticket, STATE_DIR);
  assertEquals(result.providerDone, undefined);
});

Deno.test("migration backfill-provider-done: declined jira ticket is left alone", async () => {
  const ticket = makeTicket({
    id: "jira/NW-1314",
    provider: "jira",
    phase: "wont-do",
    status: "done",
  });
  const result = await migration.run(ticket, STATE_DIR);
  assertEquals(result.providerDone, undefined);
});

Deno.test("migration backfill-provider-done: github ticket at merge/done is left alone", async () => {
  const ticket = makeTicket({
    id: "github/jackjennings/lazyboy/494",
    provider: "github",
    phase: "merge",
    status: "done",
  });
  const result = await migration.run(ticket, STATE_DIR);
  assertEquals(result.providerDone, undefined);
});

Deno.test("migration backfill-provider-done: existing providerDone is not overwritten", async () => {
  const ticket = makeTicket({
    id: "jira/NW-1700",
    provider: "jira",
    phase: "merge",
    status: "done",
    providerDone: false,
  });
  const result = await migration.run(ticket, STATE_DIR);
  assertFalse(result.providerDone);
});
