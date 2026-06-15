import { assertEquals } from "jsr:@std/assert";
import { join } from "@std/path";
import { readTicket, writeTicket, listTickets } from "./store.ts";
import type { TicketState } from "./types.ts";

const TEST_DIR = await Deno.makeTempDir();

const sample: TicketState = {
  id: "gh-99",
  provider: "github",
  title: "Test ticket",
  url: "https://github.com/x/y/issues/99",
  phase: "new",
  approved: false,
  scope: [],
  created: "2026-06-15T00:00:00Z",
  updated: "2026-06-15T00:00:00Z",
  body: "Some description",
};

Deno.test("writeTicket creates meta.md with frontmatter", async () => {
  await writeTicket(TEST_DIR, sample);
  const meta = join(TEST_DIR, "gh-99", "meta.md");
  const text = await Deno.readTextFile(meta);
  assertContains(text, "id: gh-99");
  assertContains(text, "phase: new");
});

Deno.test("readTicket parses meta.md back", async () => {
  const t = await readTicket(TEST_DIR, "gh-99");
  assertEquals(t.id, "gh-99");
  assertEquals(t.phase, "new");
  assertEquals(t.body, "Some description");
});

Deno.test("listTickets returns all ticket IDs", async () => {
  const ids = await listTickets(TEST_DIR);
  assertContains(ids, "gh-99");
});

function assertContains(haystack: string | string[], needle: string) {
  if (Array.isArray(haystack)) {
    if (!haystack.includes(needle)) throw new Error(`Expected array to contain "${needle}"`);
  } else {
    if (!haystack.includes(needle)) throw new Error(`Expected string to contain "${needle}"`);
  }
}
