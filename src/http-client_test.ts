import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { HttpClient } from "./http-client.ts";

Deno.test("HttpClient.get calls underlying fetch with method GET", async () => {
  const stubFetch = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
  );
  const client = new HttpClient(stubFetch);
  await client.get("https://example.com", { headers: { "X-Custom": "1" } });
  assertSpyCalls(stubFetch, 1);
  assertEquals(stubFetch.calls[0].args[1]?.method, "GET");
  assertEquals(
    (stubFetch.calls[0].args[1]?.headers as Record<string, string>)[
      "X-Custom"
    ],
    "1",
  );
});

Deno.test("HttpClient.post calls underlying fetch with method POST", async () => {
  const stubFetch = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
  );
  const client = new HttpClient(stubFetch);
  await client.post("https://example.com", { body: "payload" });
  assertSpyCalls(stubFetch, 1);
  assertEquals(stubFetch.calls[0].args[1]?.method, "POST");
  assertEquals(stubFetch.calls[0].args[1]?.body, "payload");
});

Deno.test("HttpClient.patch calls underlying fetch with method PATCH", async () => {
  const stubFetch = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
  );
  const client = new HttpClient(stubFetch);
  await client.patch("https://example.com");
  assertSpyCalls(stubFetch, 1);
  assertEquals(stubFetch.calls[0].args[1]?.method, "PATCH");
});

Deno.test("HttpClient returns the response from the underlying fetch", async () => {
  const client = new HttpClient(() =>
    Promise.resolve(new Response("body text", { status: 201 }))
  );
  const res = await client.get("https://example.com");
  assertEquals(res.status, 201);
  assertEquals(await res.text(), "body text");
});

Deno.test("HttpClient method overrides any method set in init", async () => {
  const stubFetch = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
  );
  const client = new HttpClient(stubFetch);
  await client.get("https://example.com", { method: "DELETE" });
  assertEquals(stubFetch.calls[0].args[1]?.method, "GET");
});
