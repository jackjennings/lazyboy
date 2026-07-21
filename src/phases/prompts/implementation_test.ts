import { assertEquals } from "@std/assert";

Deno.test(
  "implementation prompt instructs agent to append to prs array, not write prUrl",
  async () => {
    const content = await Deno.readTextFile(
      new URL("implementation.md", import.meta.url).pathname,
    );
    assertEquals(content.includes("prUrl"), false);
    assertEquals(content.includes("prs"), true);
    assertEquals(content.includes("worktreeKey"), true);
  },
);

Deno.test(
  "implementation-revision prompt does not reference prUrl",
  async () => {
    const content = await Deno.readTextFile(
      new URL("implementation-revision.md", import.meta.url).pathname,
    );
    assertEquals(content.includes("prUrl"), false);
  },
);
