import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import migration from "./1786060900-notify-dedup.ts";
import { makeTicket } from "../src/test-support.ts";

async function writeLog(stateDir: string, id: string, lines: object[]) {
  const ticketDir = join(stateDir, ...id.split("/"));
  await Deno.mkdir(ticketDir, { recursive: true });
  await Deno.writeTextFile(
    join(ticketDir, "log.ndjson"),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

Deno.test("migration notify-dedup: already has notifiedNeedsAttention — returns unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({
      id: "github/x/y/1",
      status: "needs-attention",
      notifiedNeedsAttention: false,
    });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.notifiedNeedsAttention, false);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration notify-dedup: non-needs-attention ticket — returns unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({ id: "github/x/y/1", status: "waiting" });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.notifiedNeedsAttention, undefined);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration notify-dedup: missing log — returns ticket unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({
      id: "github/x/y/1",
      status: "needs-attention",
    });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.notifiedNeedsAttention, undefined);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration notify-dedup: notified-needs-attention in log — sets notifiedNeedsAttention true", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const id = "github/x/y/1";
    await writeLog(stateDir, id, [
      { ts: "t1", event: "notified-needs-attention" },
    ]);
    const ticket = makeTicket({ id, status: "needs-attention" });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.notifiedNeedsAttention, true);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration notify-dedup: no notified-needs-attention in log — returns ticket unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const id = "github/x/y/1";
    await writeLog(stateDir, id, [
      { ts: "t1", event: "phase-output-invalid", reason: "empty" },
    ]);
    const ticket = makeTicket({ id, status: "needs-attention" });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.notifiedNeedsAttention, undefined);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
