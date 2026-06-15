import { assertEquals } from "jsr:@std/assert";
import type { TicketState } from "./types.ts";

Deno.test("TicketState has required fields", () => {
  const t: TicketState = {
    id: "gh-1",
    provider: "github",
    title: "Test",
    url: "https://github.com/x/y/issues/1",
    phase: "new",
    approved: false,
    scope: [],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    body: "",
  };
  assertEquals(t.phase, "new");
  assertEquals(t.approved, false);
});
