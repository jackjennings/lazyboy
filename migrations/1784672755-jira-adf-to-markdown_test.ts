import { assertEquals } from "@std/assert";
import migration from "./1784672755-jira-adf-to-markdown.ts";
import { makeTicket } from "../src/test-support.ts";

const adfDoc = JSON.stringify({
  type: "doc",
  version: 1,
  content: [{
    type: "paragraph",
    content: [{ type: "text", text: "Hello world" }],
  }],
});

Deno.test("migration jira-adf-to-markdown: non-jira provider — returns unchanged", async () => {
  const ticket = makeTicket({
    id: "jira/PROJ-1",
    url: "https://jira.example.com/browse/PROJ-1",
    status: "waiting",
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    provider: "github",
    body: adfDoc,
  });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, adfDoc);
});

Deno.test("migration jira-adf-to-markdown: empty body — returns unchanged", async () => {
  const ticket = makeTicket({
    id: "jira/PROJ-1",
    provider: "jira",
    url: "https://jira.example.com/browse/PROJ-1",
    status: "waiting",
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    body: "",
  });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, "");
});

Deno.test("migration jira-adf-to-markdown: valid ADF body — converts to Markdown", async () => {
  const ticket = makeTicket({
    id: "jira/PROJ-1",
    provider: "jira",
    url: "https://jira.example.com/browse/PROJ-1",
    status: "waiting",
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    body: adfDoc,
  });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, "Hello world");
});

Deno.test("migration jira-adf-to-markdown: already Markdown body — returns unchanged", async () => {
  const ticket = makeTicket({
    id: "jira/PROJ-1",
    provider: "jira",
    url: "https://jira.example.com/browse/PROJ-1",
    status: "waiting",
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    body: "Hello world",
  });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, "Hello world");
});

Deno.test("migration jira-adf-to-markdown: ADF with empty content — body becomes empty string", async () => {
  const emptyDoc = JSON.stringify({ type: "doc", content: [] });
  const ticket = makeTicket({
    id: "jira/PROJ-1",
    provider: "jira",
    url: "https://jira.example.com/browse/PROJ-1",
    status: "waiting",
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    body: emptyDoc,
  });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, "");
});

Deno.test("migration jira-adf-to-markdown: non-doc JSON — returns unchanged", async () => {
  const nonDoc = JSON.stringify({ type: "other", data: [] });
  const ticket = makeTicket({
    id: "jira/PROJ-1",
    provider: "jira",
    url: "https://jira.example.com/browse/PROJ-1",
    status: "waiting",
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    body: nonDoc,
  });
  const result = await migration.run(ticket, "/tmp");
  assertEquals(result.body, nonDoc);
});
