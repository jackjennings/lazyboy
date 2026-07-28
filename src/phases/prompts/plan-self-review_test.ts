import { assertEquals } from "@std/assert";

Deno.test("plan-self-review.md exists and contains APPROVE and REJECT", async () => {
  const content = await Deno.readTextFile(
    new URL("plan-self-review.md", import.meta.url).pathname,
  );
  assertEquals(content.includes("APPROVE"), true);
  assertEquals(content.includes("REJECT"), true);
  assertEquals(content.includes("## Task"), true);
});
