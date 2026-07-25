import { assertEquals } from "@std/assert";

Deno.test(
  "implementation prompt includes stacked PR guidance with gh stack submit --auto",
  async () => {
    const content = await Deno.readTextFile(
      new URL("implementation.md", import.meta.url).pathname,
    );
    assertEquals(content.includes("gh stack submit --auto"), true);
    assertEquals(content.includes("gh pr view"), true);
    assertEquals(content.includes("dependsOn"), true);
  },
);
