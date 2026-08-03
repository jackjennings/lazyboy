import { assertStringIncludes } from "@std/assert";

Deno.test("plan-self-review.md exists and contains APPROVE and REJECT", async () => {
  const content = await Deno.readTextFile(
    new URL("plan-self-review.md", import.meta.url).pathname,
  );
  assertStringIncludes(content, "APPROVE");
  assertStringIncludes(content, "REJECT");
  assertStringIncludes(content, "## Task");
});
