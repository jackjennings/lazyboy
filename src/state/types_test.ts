import { assertEquals, assertThrows } from "@std/assert";
import { assertValidPhaseStatus } from "./types.ts";
import type { TicketState } from "./types.ts";

Deno.test("TicketState has required fields", () => {
  const t: TicketState = {
    id: "gh-1",
    provider: "github",
    title: "Test",
    url: "https://github.com/x/y/issues/1",
    phase: "intake",
    status: "new",
    approved: false,
    scope: [],
    worktrees: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    body: "",
  };
  assertEquals(t.phase, "intake");
  assertEquals(t.status, "new");
  assertEquals(t.approved, false);
});

Deno.test("assertValidPhaseStatus: does not throw for valid combinations", () => {
  assertValidPhaseStatus("intake", "new");
  assertValidPhaseStatus("intake", "running");
  assertValidPhaseStatus("intake", "waiting");
  assertValidPhaseStatus("intake", "needs-attention");
  assertValidPhaseStatus("enrichment", "running");
  assertValidPhaseStatus("enrichment", "waiting");
  assertValidPhaseStatus("enrichment", "needs-attention");
  assertValidPhaseStatus("spec", "running");
  assertValidPhaseStatus("spec", "waiting");
  assertValidPhaseStatus("spec", "needs-attention");
  assertValidPhaseStatus("plan", "running");
  assertValidPhaseStatus("plan", "waiting");
  assertValidPhaseStatus("plan", "needs-attention");
  assertValidPhaseStatus("implementation", "running");
  assertValidPhaseStatus("implementation", "waiting");
  assertValidPhaseStatus("implementation", "revising");
  assertValidPhaseStatus("implementation", "needs-attention");
  assertValidPhaseStatus("merge", "waiting");
  assertValidPhaseStatus("merge", "done");
  assertValidPhaseStatus("merge", "needs-attention");
});

Deno.test("assertValidPhaseStatus: throws for invalid combinations", () => {
  assertThrows(() => assertValidPhaseStatus("intake", "done"), Error);
  assertThrows(() => assertValidPhaseStatus("enrichment", "new"), Error);
  assertThrows(() => assertValidPhaseStatus("enrichment", "done"), Error);
  assertThrows(() => assertValidPhaseStatus("spec", "new"), Error);
  assertThrows(() => assertValidPhaseStatus("plan", "done"), Error);
  assertThrows(() => assertValidPhaseStatus("implementation", "new"), Error);
  assertThrows(() => assertValidPhaseStatus("implementation", "done"), Error);
  assertThrows(() => assertValidPhaseStatus("merge", "new"), Error);
  assertThrows(() => assertValidPhaseStatus("merge", "running"), Error);
});

Deno.test("assertValidPhaseStatus: wont-do/done is valid", () => {
  assertValidPhaseStatus("wont-do", "done");
});

Deno.test("assertValidPhaseStatus: wont-do with non-done statuses throws", () => {
  assertThrows(() => assertValidPhaseStatus("wont-do", "running"), Error);
  assertThrows(() => assertValidPhaseStatus("wont-do", "waiting"), Error);
  assertThrows(
    () => assertValidPhaseStatus("wont-do", "needs-attention"),
    Error,
  );
});
