import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import migration from "../../migrations/1752710400-namespace-ticket-ids.ts";
import type { TicketState } from "../state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1",
    provider: "github",
    title: "T",
    url: "https://github.com/jackjennings/lazyboy/issues/1",
    phase: "intake",
    status: "new",
    approved: false,
    scope: [],
    worktrees: {},
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    body: "",
    ...overrides,
  };
}

Deno.test(
  "namespace-ticket-ids: renames GitHub ticket directory and updates ID",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      const ticketDir = join(stateDir, "gh-1");
      await Deno.mkdir(ticketDir);
      await Deno.writeTextFile(
        join(ticketDir, "meta.md"),
        "---\nid: gh-1\n---\n",
      );
      await Deno.writeTextFile(
        join(ticketDir, "log.ndjson"),
        '{"event":"status-transition"}\n',
      );
      await Deno.writeTextFile(
        join(ticketDir, "20260101T000000-intake.md"),
        "intake body",
      );
      const result = await migration.run(makeTicket(), stateDir);
      assertEquals(result.id, "github/jackjennings/lazyboy/1");
      let oldExists = true;
      try {
        await Deno.stat(ticketDir);
      } catch {
        oldExists = false;
      }
      assertEquals(oldExists, false);
      const newDir = join(stateDir, "github/jackjennings/lazyboy/1");
      assertEquals(
        await Deno.readTextFile(join(newDir, "meta.md")),
        "---\nid: gh-1\n---\n",
      );
      assertEquals(
        await Deno.readTextFile(join(newDir, "log.ndjson")),
        '{"event":"status-transition"}\n',
      );
      assertEquals(
        await Deno.readTextFile(join(newDir, "20260101T000000-intake.md")),
        "intake body",
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "namespace-ticket-ids: is idempotent for already-namespaced GitHub tickets",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      const ticket = makeTicket({ id: "github/jackjennings/lazyboy/1" });
      const result = await migration.run(ticket, stateDir);
      assertEquals(result.id, "github/jackjennings/lazyboy/1");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "namespace-ticket-ids: renames Jira ticket directory and updates ID",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      const ticketDir = join(stateDir, "jira-PROJ-123");
      await Deno.mkdir(ticketDir);
      await Deno.writeTextFile(
        join(ticketDir, "meta.md"),
        "---\nid: jira-PROJ-123\n---\n",
      );
      const ticket = makeTicket({
        id: "jira-PROJ-123",
        provider: "jira",
        url: "https://myorg.atlassian.net/browse/PROJ-123",
      });
      const result = await migration.run(ticket, stateDir);
      assertEquals(result.id, "jira/PROJ-123");
      let oldExists = true;
      try {
        await Deno.stat(ticketDir);
      } catch {
        oldExists = false;
      }
      assertEquals(oldExists, false);
      const preserved = await Deno.readTextFile(
        join(stateDir, "jira/PROJ-123", "meta.md"),
      );
      assertEquals(preserved, "---\nid: jira-PROJ-123\n---\n");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "namespace-ticket-ids: is idempotent for already-namespaced Jira tickets",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      const ticket = makeTicket({
        id: "jira/PROJ-123",
        provider: "jira",
        url: "https://myorg.atlassian.net/browse/PROJ-123",
      });
      const result = await migration.run(ticket, stateDir);
      assertEquals(result.id, "jira/PROJ-123");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "namespace-ticket-ids: returns unknown provider tickets unchanged",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      const ticket = makeTicket({ id: "other-123", provider: "other" });
      const result = await migration.run(ticket, stateDir);
      assertEquals(result.id, "other-123");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);
