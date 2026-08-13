import { assertEquals } from "@std/assert";
import migration from "./1786659835-normalize-comment-timestamps.ts";
import { makeTicket } from "../src/test-support.ts";

Deno.test("migration normalize-comment-timestamps: no lastSeenCommentTimestamp — returns unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({ id: "jira/PROJ-1" });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.lastSeenCommentTimestamp, undefined);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration normalize-comment-timestamps: Jira offset format — normalized to Zulu", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({
      id: "jira/PROJ-1",
      lastSeenCommentTimestamp: "2026-08-12T16:53:17.524-0400",
    });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.lastSeenCommentTimestamp, "2026-08-12T20:53:17.524Z");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration normalize-comment-timestamps: already Zulu — returns same value", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({
      id: "github/x/y/1",
      lastSeenCommentTimestamp: "2026-08-13T04:30:00.000Z",
    });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.lastSeenCommentTimestamp, "2026-08-13T04:30:00Z");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration normalize-comment-timestamps: malformed value — returns ticket unchanged", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({
      id: "jira/PROJ-1",
      lastSeenCommentTimestamp: "not-a-timestamp",
    });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.lastSeenCommentTimestamp, "not-a-timestamp");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration normalize-comment-timestamps: positive UTC offset — normalized to Zulu", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({
      id: "jira/PROJ-1",
      lastSeenCommentTimestamp: "2026-08-13T09:00:00.000+0530",
    });
    const result = await migration.run(ticket, stateDir);
    assertEquals(result.lastSeenCommentTimestamp, "2026-08-13T03:30:00Z");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
