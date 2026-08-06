import { assertEquals, assertThrows } from "@std/assert";
import { assertValidPhaseStatus, isApproved } from "./types.ts";
import type { TicketPhase, TicketState, TicketStatus } from "./types.ts";
import { FULL_PHASE_SEQUENCE } from "../phases/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1",
    provider: "github",
    title: "Test",
    url: "https://github.com/x/y/issues/1",
    phase: "intake",
    status: "new",
    approvals: [],
    scope: [],
    worktrees: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    body: "",
    artifact: "pr",
    ...overrides,
  };
}

Deno.test("TicketState has required fields", () => {
  const t: TicketState = makeTicket();
  assertEquals(t.phase, "intake");
  assertEquals(t.status, "new");
  assertEquals(t.approvals, []);
});

Deno.test("isApproved: empty approvals returns false", () => {
  assertEquals(
    isApproved(makeTicket({ phase: "intake", approvals: [] })),
    false,
  );
});

Deno.test("isApproved: last entry matches current phase returns true", () => {
  assertEquals(
    isApproved(
      makeTicket({
        phase: "intake",
        approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
      }),
    ),
    true,
  );
});

Deno.test("isApproved: last entry phase differs from current phase returns false", () => {
  assertEquals(
    isApproved(
      makeTicket({
        phase: "enrichment",
        approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
      }),
    ),
    false,
  );
});

Deno.test("isApproved: middle entry matches but last does not returns false", () => {
  assertEquals(
    isApproved(
      makeTicket({
        phase: "intake",
        approvals: [
          { timestamp: "t1", actor: "human", phase: "intake" },
          { timestamp: "t2", actor: "human", phase: "enrichment" },
        ],
      }),
    ),
    false,
  );
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
  assertValidPhaseStatus("merge", "revising");
  assertValidPhaseStatus("merge", "running");
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

Deno.test(
  "assertValidPhaseStatus accepts a valid status for every phase in FULL_PHASE_SEQUENCE",
  () => {
    const sample: Record<string, TicketStatus> = {
      intake: "new",
      enrichment: "running",
      spec: "running",
      plan: "running",
      implementation: "running",
      merge: "waiting",
      "wont-do": "done",
    };
    for (const phase of FULL_PHASE_SEQUENCE) {
      assertValidPhaseStatus(phase as TicketPhase, sample[phase]!);
    }
  },
);
