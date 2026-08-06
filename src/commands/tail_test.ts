import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { writeTicket } from "../state/store.ts";
import { makeTicket } from "../test-support.ts";
import { resolveTicketLogPath } from "./tail.ts";

Deno.test(
  "resolveTicketLogPath: returns log path when ticket and log exist",
  async () => {
    const stateDir = await Deno.makeTempDir();
    const ticket = makeTicket();
    try {
      await writeTicket(stateDir, ticket);
      const logPath = join(stateDir, ticket.id, "log.ndjson");
      await Deno.writeTextFile(logPath, '{"ts":"2026-01-01T00:00:00Z"}\n');
      const result = await resolveTicketLogPath(stateDir, ticket.id);
      assertEquals(result, logPath);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "resolveTicketLogPath: throws when ticket does not exist",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await assertRejects(
        () => resolveTicketLogPath(stateDir, "github/test/repo/99"),
        Error,
        "No such ticket: github/test/repo/99",
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "resolveTicketLogPath: throws when log file does not exist",
  async () => {
    const stateDir = await Deno.makeTempDir();
    const ticket = makeTicket();
    try {
      await writeTicket(stateDir, ticket);
      await assertRejects(
        () => resolveTicketLogPath(stateDir, ticket.id),
        Error,
        `No log file found for ${ticket.id}`,
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);
