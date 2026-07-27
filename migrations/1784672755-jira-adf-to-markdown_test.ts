import { assertEquals } from "@std/assert";
import migration from "./1784672755-jira-adf-to-markdown.ts";
import type { TicketState } from "../src/state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "jira/PROJ-1",
    provider: "jira",
    title: "T",
    url: "https://jira.example.com/browse/PROJ-1",
    phase: "intake",
    status: "waiting",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    body: "",
    ...overrides,
  };
}

const adfDoc = JSON.stringify({
  type: "doc",
  version: 1,
  content: [{
    type: "paragraph",
    content: [{ type: "text", text: "Hello world" }],
  }],
});

Deno.test("migration jira-adf-to-markdown: non-jira provider — returns unchanged", async () => {
  const ticket = makeTicket({ provider: "github", body: adfDoc });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, adfDoc);
});

Deno.test("migration jira-adf-to-markdown: empty body — returns unchanged", async () => {
  const ticket = makeTicket({ body: "" });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, "");
});

Deno.test("migration jira-adf-to-markdown: valid ADF body — converts to Markdown", async () => {
  const ticket = makeTicket({ body: adfDoc });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, "Hello world");
});

Deno.test("migration jira-adf-to-markdown: already Markdown body — returns unchanged", async () => {
  const ticket = makeTicket({ body: "Hello world" });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, "Hello world");
});

Deno.test("migration jira-adf-to-markdown: ADF with empty content — body becomes empty string", async () => {
  const emptyDoc = JSON.stringify({ type: "doc", content: [] });
  const ticket = makeTicket({ body: emptyDoc });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, "");
});

Deno.test("migration jira-adf-to-markdown: non-doc JSON — returns unchanged", async () => {
  const nonDoc = JSON.stringify({ type: "other", data: [] });
  const ticket = makeTicket({ body: nonDoc });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, nonDoc);
});
