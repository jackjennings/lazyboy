import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { writeTicket } from "../state/store.ts";
import type { TicketState } from "../state/types.ts";
import { performRetry } from "./retry.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "github/test/repo/1",
    provider: "github",
    title: "Test ticket",
    url: "https://github.com/test/repo/issues/1",
    phase: "spec",
    status: "needs-attention",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    body: "Test body",
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
  await new Deno.Command("git", {
    args: ["add", "-A"],
    cwd: stateDir,
  }).output();
  await new Deno.Command("git", {
    args: ["commit", "-m", "initial"],
    cwd: stateDir,
  }).output();
  return stateDir;
}

Deno.test(
  "performRetry: throws when ticket is not in needs-attention",
  async () => {
    const ticket = makeTicket({ phase: "spec", status: "waiting" });
    const stateDir = await setupGitStateDir(ticket);
    try {
      await assertRejects(
        () => performRetry(stateDir, ticket.id),
        Error,
        "needs-attention",
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "performRetry: throws when ticket is running",
  async () => {
    const ticket = makeTicket({ phase: "plan", status: "running" });
    const stateDir = await setupGitStateDir(ticket);
    try {
      await assertRejects(
        () => performRetry(stateDir, ticket.id),
        Error,
        "needs-attention",
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "performRetry: resets spec/needs-attention to spec/waiting",
  async () => {
    const ticket = makeTicket({
      phase: "spec",
      status: "needs-attention",
    });
    const stateDir = await setupGitStateDir(ticket);
    try {
      await performRetry(stateDir, ticket.id);
      const meta = await Deno.readTextFile(
        join(stateDir, ticket.id, "meta.md"),
      );
      assertStringIncludes(meta, "status: waiting");
      assertStringIncludes(meta, "phase: spec");
      assertEquals(meta.includes("pid:"), false);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "performRetry: resets intake/needs-attention to intake/new",
  async () => {
    const ticket = makeTicket({
      phase: "intake",
      status: "needs-attention",
    });
    const stateDir = await setupGitStateDir(ticket);
    try {
      await performRetry(stateDir, ticket.id);
      const meta = await Deno.readTextFile(
        join(stateDir, ticket.id, "meta.md"),
      );
      assertStringIncludes(meta, "status: new");
      assertStringIncludes(meta, "phase: intake");
      assertEquals(meta.includes("pid:"), false);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "performRetry: preserves approvals through retry",
  async () => {
    const ticket = makeTicket({
      phase: "implementation",
      status: "needs-attention",
      approvals: [
        {
          timestamp: "2026-01-01T00:00:00Z",
          actor: "human",
          phase: "implementation",
        },
      ],
    });
    const stateDir = await setupGitStateDir(ticket);
    try {
      await performRetry(stateDir, ticket.id);
      const meta = await Deno.readTextFile(
        join(stateDir, ticket.id, "meta.md"),
      );
      assertEquals(meta.includes("approved:"), false);
      assertStringIncludes(meta, "actor: human");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "performRetry: appends status-transition log entry",
  async () => {
    const ticket = makeTicket({ phase: "plan", status: "needs-attention" });
    const stateDir = await setupGitStateDir(ticket);
    try {
      await performRetry(stateDir, ticket.id);
      const log = await Deno.readTextFile(
        join(stateDir, ticket.id, "log.ndjson"),
      );
      const entry = JSON.parse(log.trim().split("\n").at(-1)!);
      assertEquals(entry.event, "status-transition");
      assertEquals(entry.phase, "plan");
      assertEquals(entry.from, "needs-attention");
      assertEquals(entry.to, "waiting");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "performRetry: appends log with 'new' as target for intake phase",
  async () => {
    const ticket = makeTicket({ phase: "intake", status: "needs-attention" });
    const stateDir = await setupGitStateDir(ticket);
    try {
      await performRetry(stateDir, ticket.id);
      const log = await Deno.readTextFile(
        join(stateDir, ticket.id, "log.ndjson"),
      );
      const entry = JSON.parse(log.trim().split("\n").at(-1)!);
      assertEquals(entry.event, "status-transition");
      assertEquals(entry.phase, "intake");
      assertEquals(entry.from, "needs-attention");
      assertEquals(entry.to, "new");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "performRetry: makes a git commit",
  async () => {
    const ticket = makeTicket({
      phase: "enrichment",
      status: "needs-attention",
    });
    const stateDir = await setupGitStateDir(ticket);
    try {
      await performRetry(stateDir, ticket.id);
      const result = await new Deno.Command("git", {
        args: ["log", "--oneline"],
        cwd: stateDir,
        stdout: "piped",
      }).output();
      const log = new TextDecoder().decode(result.stdout);
      assertStringIncludes(log, `retry: ${ticket.id}`);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);
