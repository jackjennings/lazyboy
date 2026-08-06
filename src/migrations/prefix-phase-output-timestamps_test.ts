import {
  assertArrayIncludes,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "@std/assert";
import { join } from "@std/path";
import migration from "../../migrations/1783986778-prefix-phase-output-timestamps.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(id: string): TicketState {
  return {
    id,
    provider: "github",
    title: "T",
    url: "u",
    phase: "spec",
    status: "waiting",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    body: "",
    artifact: "pr",
  };
}

async function initGitRepo(dir: string): Promise<void> {
  const run = (args: string[]) =>
    new Deno.Command("git", { args, cwd: dir }).output();
  await run(["init"]);
  await run(["config", "user.email", "t@t.com"]);
  await run(["config", "user.name", "T"]);
  await run(["config", "commit.gpgsign", "false"]);
}

Deno.test("migration: renames suffixed revision file to prefixed format", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await initGitRepo(stateDir);
    const ticketDir = join(stateDir, "gh-1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "spec-20260629T225507.md"),
      "revision",
    );
    await migration.run(makeTicket("gh-1"), stateDir);
    const entries: string[] = [];
    for await (const e of Deno.readDir(ticketDir)) entries.push(e.name);
    assertArrayIncludes(entries, ["20260629T225507-spec.md"]);
    assertFalse(entries.includes("spec-20260629T225507.md"));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration: renames hyphenated-date feedback file to prefixed format", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await initGitRepo(stateDir);
    const ticketDir = join(stateDir, "gh-1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "spec-feedback-2026-06-29T224653.md"),
      "feedback",
    );
    await migration.run(makeTicket("gh-1"), stateDir);
    const entries: string[] = [];
    for await (const e of Deno.readDir(ticketDir)) entries.push(e.name);
    assertArrayIncludes(entries, ["20260629T224653-spec-feedback.md"]);
    assertFalse(entries.includes("spec-feedback-2026-06-29T224653.md"));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration: renames canonical phase file using mtime when not committed", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await initGitRepo(stateDir);
    const ticketDir = join(stateDir, "gh-1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(join(ticketDir, "spec.md"), "canonical");
    await migration.run(makeTicket("gh-1"), stateDir);
    const entries: string[] = [];
    for await (const e of Deno.readDir(ticketDir)) entries.push(e.name);
    const renamed = entries.find((n) => /^\d{8}T\d{6}-spec\.md$/.test(n));
    assertNotEquals(renamed, undefined);
    assertFalse(entries.includes("spec.md"));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration: renames canonical file using git log timestamp when committed", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await initGitRepo(stateDir);
    const ticketDir = join(stateDir, "gh-1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(join(ticketDir, "spec.md"), "canonical");
    const run = (args: string[]) =>
      new Deno.Command("git", { args, cwd: stateDir }).output();
    await run(["add", "-A"]);
    await run(["commit", "-m", "add spec"]);
    await migration.run(makeTicket("gh-1"), stateDir);
    const entries: string[] = [];
    for await (const e of Deno.readDir(ticketDir)) entries.push(e.name);
    const renamed = entries.find((n) => /^\d{8}T\d{6}-spec\.md$/.test(n));
    assertNotEquals(renamed, undefined);
    assertFalse(entries.includes("spec.md"));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration: skips files already matching new prefix pattern", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await initGitRepo(stateDir);
    const ticketDir = join(stateDir, "gh-1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260629T225507-spec.md"),
      "already prefixed",
    );
    await migration.run(makeTicket("gh-1"), stateDir);
    const entries: string[] = [];
    for await (const e of Deno.readDir(ticketDir)) entries.push(e.name);
    assertEquals(entries, ["20260629T225507-spec.md"]);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration: returns ticket state unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await initGitRepo(stateDir);
    await Deno.mkdir(join(stateDir, "gh-1"), { recursive: true });
    const ticket = makeTicket("gh-1");
    const result = await migration.run(ticket, stateDir);
    assertEquals(result, ticket);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration: silently returns when ticket directory does not exist", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await initGitRepo(stateDir);
    const ticket = makeTicket("gh-missing");
    const result = await migration.run(ticket, stateDir);
    assertEquals(result, ticket);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
