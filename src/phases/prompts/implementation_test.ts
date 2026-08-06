import { assertFalse, assertStringIncludes } from "@std/assert";

Deno.test(
  "implementation prompt includes formatter and linter as numbered step",
  async () => {
    const content = await Deno.readTextFile(
      new URL("implementation.md", import.meta.url).pathname,
    );
    assertStringIncludes(content, "formatter and linter");
    assertFalse(content.includes("deno fmt && deno lint"));
    assertFalse(content.includes("deno task test"));
    assertStringIncludes(
      content,
      "same change applied to two independent files",
    );
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
