import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { applyLearning } from "./apply-learning.ts";

function respondingWith(text: string) {
  return spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ content: [{ type: "text", text }] }),
          { status: 200 },
        ),
      ),
  );
}

const CURRENT = "# Implementation\n\nDo the thing.\n";
const INTENT =
  "Add an instruction to enumerate all call sites before renaming.";

Deno.test("applyLearning: returns the document wrapped in updated-file tags", async () => {
  const placed =
    "# Implementation\n\nDo the thing.\n\nEnumerate all call sites first.\n";
  const fetcher = respondingWith(
    `<updated-file>${placed}</updated-file>`,
  );
  const result = await applyLearning(CURRENT, INTENT, fetcher);
  assertEquals(result, placed);
  assertSpyCalls(fetcher, 1);
});

Deno.test("applyLearning: falls back to trimmed text when tags are absent", async () => {
  const placed =
    "# Implementation\n\nDo the thing.\n\nEnumerate all call sites first.";
  const fetcher = respondingWith(`\n${placed}\n`);
  const result = await applyLearning(CURRENT, INTENT, fetcher);
  assertEquals(result, `${placed}\n`);
});

Deno.test("applyLearning: sends the current document and the intent to the model", async () => {
  const fetcher = respondingWith("<updated-file>x</updated-file>");
  await applyLearning(CURRENT, INTENT, fetcher);
  const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
  const sent = JSON.stringify(body);
  assertStringIncludes(sent, INTENT);
  assertStringIncludes(sent, "Do the thing.");
});

Deno.test("applyLearning: returns null on non-OK HTTP status", async () => {
  const fetcher = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response("{}", { status: 500 })),
  );
  const result = await applyLearning(CURRENT, INTENT, fetcher);
  assertEquals(result, null);
});

Deno.test("applyLearning: returns null when fetch throws", async () => {
  const fetcher = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.reject(new Error("network error")),
  );
  const result = await applyLearning(CURRENT, INTENT, fetcher);
  assertEquals(result, null);
});

Deno.test("applyLearning: returns null when the model returns empty text", async () => {
  const fetcher = respondingWith("   ");
  const result = await applyLearning(CURRENT, INTENT, fetcher);
  assertEquals(result, null);
});
