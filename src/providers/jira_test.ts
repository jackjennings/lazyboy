import { assertEquals, assertRejects } from "@std/assert";
import { JiraProvider } from "./jira.ts";

const BASE_URL = "https://myorg.atlassian.net";

function makeIssue(
  key: string,
  summary: string,
  description: unknown = null,
) {
  return { id: "10001", key, fields: { summary, description } };
}

Deno.test("fetchNew returns all items when knownIds is empty", async () => {
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ issues: [makeIssue("PROJ-1", "Issue One")] }),
          { status: 200 },
        ),
      ),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "jira/PROJ-1");
  assertEquals(items[0].provider, "jira");
  assertEquals(items[0].title, "Issue One");
  assertEquals(items[0].url, `${BASE_URL}/browse/PROJ-1`);
});

Deno.test("fetchNew filters known IDs", async () => {
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            issues: [
              makeIssue("PROJ-1", "One"),
              makeIssue("PROJ-2", "Two"),
            ],
          }),
          { status: 200 },
        ),
      ),
  });
  const items = await provider.fetchNew(new Set(["jira/PROJ-1"]));
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "jira/PROJ-2");
});

Deno.test("fetchNew does not re-create an issue tracked under its legacy jira-<KEY> id", async () => {
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ issues: [makeIssue("PROJ-1", "One")] }),
          { status: 200 },
        ),
      ),
  });
  const items = await provider.fetchNew(new Set(["jira-PROJ-1"]));
  assertEquals(items.length, 0);
});

Deno.test("fetchNew uses POST to /rest/api/3/search/jql", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (url, init) => {
      capturedUrl = url;
      capturedMethod = init.method ?? "GET";
      return Promise.resolve(
        new Response(JSON.stringify({ issues: [] }), { status: 200 }),
      );
    },
  });
  await provider.fetchNew(new Set());
  assertEquals(capturedUrl, `${BASE_URL}/rest/api/3/search/jql`);
  assertEquals(capturedMethod, "POST");
});

Deno.test("fetchNew throws on non-2xx response", async () => {
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (_url, _init) =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
  });
  await assertRejects(
    () => provider.fetchNew(new Set()),
    Error,
    "Jira API error: 401",
  );
});

Deno.test("fetchNew skips issues with missing fields", async () => {
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            issues: [
              { id: "1", key: "PROJ-1" },
              makeIssue("PROJ-2", "Valid"),
            ],
          }),
          { status: 200 },
        ),
      ),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "jira/PROJ-2");
});

Deno.test("fetchNew description is empty string when fields.description is null", async () => {
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ issues: [makeIssue("PROJ-1", "T", null)] }),
          { status: 200 },
        ),
      ),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items[0].description, "");
});

Deno.test("fetchNew description is empty string when fields.description is undefined", async () => {
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            issues: [{ id: "1", key: "PROJ-1", fields: { summary: "T" } }],
          }),
          { status: 200 },
        ),
      ),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items[0].description, "");
});

Deno.test("fetchNew description is JSON.stringify when fields.description is an object", async () => {
  const desc = { type: "doc", content: [] };
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            issues: [makeIssue("PROJ-1", "T", desc)],
          }),
          { status: 200 },
        ),
      ),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items[0].description, JSON.stringify(desc));
});
