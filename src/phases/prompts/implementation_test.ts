import { assertStringIncludes } from "@std/assert";

Deno.test(
  "implementation prompt includes deno fmt && deno lint as numbered step",
  async () => {
    const content = await Deno.readTextFile(
      new URL("implementation.md", import.meta.url).pathname,
    );
    assertStringIncludes(content, "deno fmt && deno lint");
  },
);

Deno.test(
  "implementation prompt includes stacked PR guidance with gh stack submit --auto",
  async () => {
    const content = await Deno.readTextFile(
      new URL("implementation.md", import.meta.url).pathname,
    );
    assertStringIncludes(content, "gh stack submit --auto");
    assertStringIncludes(content, "gh pr view");
    assertStringIncludes(content, "dependsOn");
  },
);
