import {
  assertEquals,
  assertFalse,
  assertLess,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { JiraProvider } from "./jira.ts";
import { compareSortKeys } from "./types.ts";

const BASE_URL = "https://myorg.atlassian.net";

function makeIssue(
  key: string,
  summary: string,
  description: unknown = null,
  parentKey?: string,
) {
  const fields: {
    summary: string;
    description: unknown;
    parent?: { key: string; fields: { summary: string } };
  } = { summary, description };
  if (parentKey) fields.parent = { key: parentKey, fields: { summary: "" } };
  return { id: "10001", key, fields };
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

Deno.test("close transitions the issue to the done status category", async () => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (url, init) => {
      requests.push({ url, method: init.method, body: init.body as string });
      if (!init.method) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              transitions: [
                { id: "31", to: { statusCategory: { key: "done" } } },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });
  await provider.close(`${BASE_URL}/browse/PROJ-1`);
  assertEquals(
    requests[0].url,
    `${BASE_URL}/rest/api/3/issue/PROJ-1/transitions`,
  );
  assertEquals(requests[1].method, "POST");
  assertEquals(JSON.parse(requests[1].body!), { transition: { id: "31" } });
});

Deno.test("close throws on unrecognized URL", async () => {
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
  });
  await assertRejects(
    () => provider.close("https://example.com/not-a-jira-issue"),
    Error,
  );
});

Deno.test("fetchNew description is Markdown when fields.description is an ADF object", async () => {
  const desc = {
    type: "doc",
    version: 1,
    content: [{
      type: "paragraph",
      content: [{ type: "text", text: "Hello world" }],
    }],
  };
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
  assertEquals(items[0].description, "Hello world");
});

Deno.test("toSortable: jira/PROJ-3 returns [PROJ, 3]", () => {
  assertEquals(JiraProvider.toSortable("jira/PROJ-3"), ["PROJ", 3]);
});

Deno.test("toSortable: issue 3 sorts before issue 12 via compareSortKeys", () => {
  assertLess(
    compareSortKeys(
      JiraProvider.toSortable("jira/PROJ-3"),
      JiraProvider.toSortable("jira/PROJ-12"),
    ),
    0,
  );
});

Deno.test("toSortable: different projects sort by key first", () => {
  assertLess(
    compareSortKeys(
      JiraProvider.toSortable("jira/ABC-100"),
      JiraProvider.toSortable("jira/PROJ-1"),
    ),
    0,
  );
});

Deno.test("toSortable: malformed id falls back to [id]", () => {
  assertEquals(JiraProvider.toSortable("jira/malformed"), ["jira/malformed"]);
});

Deno.test("fetchNew appends parent context when issue has one parent", async () => {
  const provider = new JiraProvider({
    baseUrl: BASE_URL,
    email: "test@example.com",
    apiToken: "token",
    project: "PROJ",
    _fetch: (url, _init) => {
      if (url === `${BASE_URL}/rest/api/3/search/jql`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              issues: [makeIssue("PROJ-1", "Sub-task", null, "STORY-10")],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            fields: { summary: "The Story", description: null },
          }),
          { status: 200 },
        ),
      );
    },
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 1);
  assertStringIncludes(items[0].description, "\n\n---\n\n");
  assertStringIncludes(
    items[0].description,
    "## Parent context: STORY-10 — The Story",
  );
});

Deno.test(
  "fetchNew appends parent and grandparent context for two-level ancestor chain",
  async () => {
    const provider = new JiraProvider({
      baseUrl: BASE_URL,
      email: "test@example.com",
      apiToken: "token",
      project: "PROJ",
      _fetch: (url, _init) => {
        if (url === `${BASE_URL}/rest/api/3/search/jql`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                issues: [makeIssue("PROJ-1", "Sub-task", null, "STORY-10")],
              }),
              { status: 200 },
            ),
          );
        }
        if (url.includes("/issue/STORY-10")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                fields: {
                  summary: "The Story",
                  description: null,
                  parent: { key: "EPIC-5" },
                },
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              fields: { summary: "The Epic", description: null },
            }),
            { status: 200 },
          ),
        );
      },
    });
    const items = await provider.fetchNew(new Set());
    assertEquals(items.length, 1);
    assertStringIncludes(
      items[0].description,
      "## Parent context: STORY-10 — The Story",
    );
    assertStringIncludes(
      items[0].description,
      "## Parent context: EPIC-5 — The Epic",
    );
    const separatorCount = (items[0].description.match(/\n---\n/g) ?? [])
      .length;
    assertEquals(separatorCount, 1);
  },
);

Deno.test("fetchNew description is unchanged when issue has no parent", async () => {
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
  assertEquals(items[0].description, "");
});

Deno.test(
  "fetchNew ingests issue normally when parent fetch returns 404",
  async () => {
    const provider = new JiraProvider({
      baseUrl: BASE_URL,
      email: "test@example.com",
      apiToken: "token",
      project: "PROJ",
      _fetch: (url, _init) => {
        if (url === `${BASE_URL}/rest/api/3/search/jql`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                issues: [makeIssue("PROJ-1", "Sub-task", null, "STORY-10")],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      },
    });
    const items = await provider.fetchNew(new Set());
    assertEquals(items.length, 1);
    assertFalse(items[0].description.includes("Parent context"));
    assertFalse(items[0].description.includes("---"));
  },
);

Deno.test(
  "fetchNew ingests issue normally when parent fetch returns 403",
  async () => {
    const provider = new JiraProvider({
      baseUrl: BASE_URL,
      email: "test@example.com",
      apiToken: "token",
      project: "PROJ",
      _fetch: (url, _init) => {
        if (url === `${BASE_URL}/rest/api/3/search/jql`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                issues: [makeIssue("PROJ-1", "Sub-task", null, "STORY-10")],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response("Forbidden", { status: 403 }));
      },
    });
    const items = await provider.fetchNew(new Set());
    assertEquals(items.length, 1);
    assertFalse(items[0].description.includes("Parent context"));
  },
);
