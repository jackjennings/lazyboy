import { assertEquals } from "@std/assert";
import { makeTicket } from "./test-support.ts";

Deno.test("makeTicket: returns base shape with no args", () => {
  const t = makeTicket();
  assertEquals(t.id, "github/org/repo/1");
  assertEquals(t.provider, "github");
  assertEquals(t.title, "T");
  assertEquals(t.url, "https://github.com/org/repo/issues/1");
  assertEquals(t.phase, "intake");
  assertEquals(t.status, "new");
  assertEquals(t.approvals, []);
  assertEquals(t.scope, []);
  assertEquals(t.worktrees, {});
  assertEquals(t.created, "2026-01-01T00:00:00Z");
  assertEquals(t.updated, "2026-01-01T00:00:00Z");
  assertEquals(t.body, "");
  assertEquals(t.artifacts, ["code"]);
});

Deno.test("makeTicket: spreads overrides over base", () => {
  const t = makeTicket({ phase: "spec", status: "waiting" });
  assertEquals(t.phase, "spec");
  assertEquals(t.status, "waiting");
  assertEquals(t.id, "github/org/repo/1");
});
