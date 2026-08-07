import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { jiraPickupAction } from "./jira-pickup.ts";
import { makeTicket } from "../test-support.ts";
import { HttpClient } from "../http-client.ts";

function makeAction(
  overrides: Partial<Parameters<typeof jiraPickupAction>[0]> = {},
) {
  return jiraPickupAction({
    baseUrl: "https://myorg.atlassian.net",
    email: "test@example.com",
    apiToken: "token",
    appendLog: () => Promise.resolve(),
    http: new HttpClient(),
    ...overrides,
  });
}

function makeTransitionsFetch(
  transitions: Array<{ id: string; to: { statusCategory: { key: string } } }>,
) {
  return (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    if (init?.method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ transitions }), { status: 200 }),
    );
  };
}

const BASE = {
  id: "jira/PROJ-42",
  provider: "jira" as const,
  url: "https://myorg.atlassian.net/browse/PROJ-42",
  created: "2026-07-01T00:00:00Z",
  updated: "2026-07-01T00:00:00Z",
};

Deno.test("jiraPickupAction: applies when provider is jira and status is new", () => {
  assert(makeAction().applies(makeTicket(BASE)));
});

Deno.test("jiraPickupAction: does not apply when provider is not jira", () => {
  assertFalse(
    makeAction().applies(makeTicket({ ...BASE, provider: "github" })),
  );
});

Deno.test("jiraPickupAction: does not apply when status is not new", () => {
  assertFalse(
    makeAction().applies(makeTicket({ ...BASE, status: "running" })),
  );
});

Deno.test("jiraPickupAction: run calls GET transitions then POST with in-progress id for correct issue key", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const result = await makeAction({
    http: new HttpClient((url, init) => {
      calls.push({
        url: url as string,
        method: init?.method ?? "GET",
        body: init?.body as string | undefined,
      });
      if (init?.method === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            transitions: [
              { id: "31", to: { statusCategory: { key: "in-progress" } } },
            ],
          }),
          { status: 200 },
        ),
      );
    }),
  }).run(makeTicket(BASE), "/state");
  assertEquals(result, null);
  assertEquals(calls.length, 2);
  assertStringIncludes(calls[0].url, "/issue/PROJ-42/transitions");
  assertEquals(calls[0].method, "GET");
  assertStringIncludes(calls[1].url, "/issue/PROJ-42/transitions");
  assertEquals(calls[1].method, "POST");
  assertEquals(
    JSON.parse(calls[1].body!),
    { transition: { id: "31" } },
  );
});

Deno.test("jiraPickupAction: run returns null on success", async () => {
  const result = await makeAction({
    http: new HttpClient(makeTransitionsFetch([
      { id: "31", to: { statusCategory: { key: "in-progress" } } },
    ])),
  }).run(makeTicket(BASE), "/state");
  assertEquals(result, null);
});

Deno.test("jiraPickupAction: run logs error and returns null when transition throws", async () => {
  const logged: object[] = [];
  const result = await makeAction({
    http: new HttpClient((_url, _init) =>
      Promise.resolve(new Response("Forbidden", { status: 403 }))
    ),
    appendLog: (_stateDir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals(result, null);
  assertEquals(logged.length, 1);
  assertEquals((logged[0] as Record<string, string>).event, "error");
  assertEquals((logged[0] as Record<string, string>).context, "jiraPickup");
});

Deno.test("jiraPickupAction: run logs error when no matching transition found", async () => {
  const logged: object[] = [];
  await makeAction({
    http: new HttpClient(makeTransitionsFetch([
      { id: "10", to: { statusCategory: { key: "done" } } },
    ])),
    appendLog: (_stateDir, _id, entry) => {
      logged.push(entry);
      return Promise.resolve();
    },
  }).run(makeTicket(BASE), "/state");
  assertEquals((logged[0] as Record<string, string>).event, "error");
  assertEquals((logged[0] as Record<string, string>).context, "jiraPickup");
});
