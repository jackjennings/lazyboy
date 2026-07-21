import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { writeTicket } from "../state/store.ts";
import type { TicketState } from "../state/types.ts";
import { performDecline } from "./decline.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "github/test/repo/1",
    provider: "github",
    title: "Test ticket",
    url: "https://github.com/test/repo/issues/1",
    phase: "spec",
    status: "waiting",
    approved: false,
    scope: [],
    worktrees: {},
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    body: "Original body",
    ...overrides,
  };
}

async function setupGitStateDir(ticket: TicketState): Promise<string> {
  const stateDir = await Deno.makeTempDir();
  await writeTicket(stateDir, ticket);
  await new Deno.Command("git", { args: ["init"], cwd: stateDir }).output();
  await new Deno.Command("git", {
    args: ["config", "user.email", "test@test.com"],
    cwd: stateDir,
  }).output();
  await new Deno.Command("git", {
    args: ["config", "user.name", "Test"],
    cwd: stateDir,
  }).output();
  await new Deno.Command("git", { args: ["add", "-A"], cwd: stateDir })
    .output();
  await new Deno.Command("git", {
    args: ["commit", "-m", "initial"],
    cwd: stateDir,
  }).output();
  return stateDir;
}

Deno.test("performDecline: transitions ticket to wont-do/done", async () => {
  const ticket = makeTicket({ phase: "plan", status: "waiting" });
  const stateDir = await setupGitStateDir(ticket);
  try {
    await performDecline(stateDir, ticket.id);
    const meta = await Deno.readTextFile(
      join(stateDir, ticket.id, "meta.md"),
    );
    assertStringIncludes(meta, "phase: wont-do");
    assertStringIncludes(meta, "status: done");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("performDecline: clears pid and sets approved false", async () => {
  const ticket = makeTicket({
    phase: "implementation",
    status: "running",
    pid: 12345,
    approved: true,
  });
  const stateDir = await setupGitStateDir(ticket);
  try {
    await performDecline(stateDir, ticket.id);
    const meta = await Deno.readTextFile(
      join(stateDir, ticket.id, "meta.md"),
    );
    assertStringIncludes(meta, "approved: false");
    assertEquals(meta.includes("pid:"), false);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("performDecline: appends phase-transition log entry", async () => {
  const ticket = makeTicket({ phase: "enrichment", status: "waiting" });
  const stateDir = await setupGitStateDir(ticket);
  try {
    await performDecline(stateDir, ticket.id);
    const log = await Deno.readTextFile(
      join(stateDir, ticket.id, "log.ndjson"),
    );
    const entries = log.trim().split("\n").map((l) => JSON.parse(l));
    const transition = entries.find((e) => e.event === "phase-transition");
    assertEquals(transition?.from, "enrichment");
    assertEquals(transition?.to, "wont-do");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("performDecline: makes a git commit with decline message", async () => {
  const ticket = makeTicket();
  const stateDir = await setupGitStateDir(ticket);
  try {
    await performDecline(stateDir, ticket.id);
    const result = await new Deno.Command("git", {
      args: ["log", "--oneline", "-1"],
      cwd: stateDir,
    }).output();
    const log = new TextDecoder().decode(result.stdout);
    assertStringIncludes(log, `decline: ${ticket.id}`);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("performDecline: without reason leaves body unchanged", async () => {
  const ticket = makeTicket({ body: "Original body" });
  const stateDir = await setupGitStateDir(ticket);
  try {
    await performDecline(stateDir, ticket.id);
    const meta = await Deno.readTextFile(
      join(stateDir, ticket.id, "meta.md"),
    );
    assertStringIncludes(meta, "Original body");
    assertEquals(meta.includes("Declined:"), false);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("performDecline: with reason appends to body", async () => {
  const ticket = makeTicket({ body: "Original body" });
  const stateDir = await setupGitStateDir(ticket);
  try {
    await performDecline(stateDir, ticket.id, "requires manual design review");
    const meta = await Deno.readTextFile(
      join(stateDir, ticket.id, "meta.md"),
    );
    assertStringIncludes(meta, "Original body");
    assertStringIncludes(meta, "Declined: requires manual design review");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("performDecline: returns original phase", async () => {
  const ticket = makeTicket({ phase: "spec", status: "waiting" });
  const stateDir = await setupGitStateDir(ticket);
  try {
    const result = await performDecline(stateDir, ticket.id);
    assertEquals(result.from, "spec");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
