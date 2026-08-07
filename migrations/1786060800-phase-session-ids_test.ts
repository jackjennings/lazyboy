import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import migration from "./1786060800-phase-session-ids.ts";
import { makeTicket } from "../src/test-support.ts";

async function writeLog(stateDir: string, id: string, lines: object[]) {
  const ticketDir = join(stateDir, ...id.split("/"));
  await Deno.mkdir(ticketDir, { recursive: true });
  await Deno.writeTextFile(
    join(ticketDir, "log.ndjson"),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

Deno.test("migration phase-session-ids: already has phaseSessionIds — returns unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({
      id: "github/x/y/1",
      phaseSessionIds: { intake: "existing" },
    });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.phaseSessionIds, { intake: "existing" });
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration phase-session-ids: missing log — returns ticket unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({ id: "github/x/y/1" });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.phaseSessionIds, undefined);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration phase-session-ids: extracts sessionId from phase-end entries", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const id = "github/x/y/1";
    await writeLog(stateDir, id, [
      {
        ts: "t1",
        event: "phase-end",
        phase: "20260806T002625-intake",
        sessionId: "sess-intake",
      },
      {
        ts: "t2",
        event: "phase-end",
        phase: "20260806T010000-spec",
        sessionId: "sess-spec",
      },
    ]);
    const result = await migration.run(makeTicket({ id }), stateDir);
    assertEquals(result.phaseSessionIds?.["intake"], "sess-intake");
    assertEquals(result.phaseSessionIds?.["spec"], "sess-spec");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration phase-session-ids: clears implementation sessionId on conflict-resolution-started", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const id = "github/x/y/1";
    await writeLog(stateDir, id, [
      {
        ts: "t1",
        event: "phase-end",
        phase: "20260806T002625-implementation",
        sessionId: "sess-impl",
      },
      { ts: "t2", event: "conflict-resolution-started" },
    ]);
    const result = await migration.run(makeTicket({ id }), stateDir);
    assertEquals(result.phaseSessionIds?.["implementation"], undefined);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration phase-session-ids: restores implementation sessionId when conflict-resolution-started precedes phase-end", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const id = "github/x/y/1";
    await writeLog(stateDir, id, [
      {
        ts: "t1",
        event: "phase-end",
        phase: "20260806T002625-implementation",
        sessionId: "sess-old",
      },
      { ts: "t2", event: "conflict-resolution-started" },
      {
        ts: "t3",
        event: "phase-end",
        phase: "20260806T010000-implementation",
        sessionId: "sess-new",
      },
    ]);
    const result = await migration.run(makeTicket({ id }), stateDir);
    assertEquals(result.phaseSessionIds?.["implementation"], "sess-new");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration phase-session-ids: skips phase-end with no sessionId", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const id = "github/x/y/1";
    await writeLog(stateDir, id, [
      { ts: "t1", event: "phase-end", phase: "20260806T002625-intake" },
    ]);
    const result = await migration.run(makeTicket({ id }), stateDir);
    assertEquals(result.phaseSessionIds, undefined);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
