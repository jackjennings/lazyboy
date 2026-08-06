import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import migration from "./1784944292-approvals-log.ts";
import type { TicketState } from "../src/state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "github/x/y/1",
    provider: "github",
    title: "T",
    url: "https://github.com/x/y/issues/1",
    phase: "intake",
    status: "waiting",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-20T10:00:00Z",
    body: "",
    artifact: "pr",
    ...overrides,
  };
}

async function writeMeta(dir: string, id: string, content: string) {
  const ticketDir = join(dir, ...id.split("/"));
  await Deno.mkdir(ticketDir, { recursive: true });
  await Deno.writeTextFile(join(ticketDir, "meta.md"), content);
}

Deno.test("migration approvals-log: already has approvals — returns unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({
      approvals: [{ timestamp: "t", actor: "human", phase: "intake" }],
    });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.approvals, ticket.approvals);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration approvals-log: approved false — sets approvals to []", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const id = "github/x/y/1";
    const ticket = makeTicket({ id, approvals: undefined as unknown as [] });
    await writeMeta(
      stateDir,
      id,
      "---\nphase: intake\nstatus: waiting\napproved: false\n---\n",
    );
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.approvals, []);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration approvals-log: approved true — creates unknown entry at ticket.updated", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const id = "github/x/y/1";
    const ticket = makeTicket({ id, approvals: undefined as unknown as [] });
    await writeMeta(
      stateDir,
      id,
      "---\nphase: intake\nstatus: waiting\napproved: true\n---\n",
    );
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.approvals.length, 1);
    assertEquals(result.approvals[0].actor, "unknown");
    assertEquals(result.approvals[0].phase, "intake");
    assertEquals(result.approvals[0].timestamp, ticket.updated);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration approvals-log: missing meta file — sets approvals to []", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({ approvals: undefined as unknown as [] });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.approvals, []);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
