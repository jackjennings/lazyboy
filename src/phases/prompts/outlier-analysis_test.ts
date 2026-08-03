import { assertFalse, assertStringIncludes } from "@std/assert";

Deno.test(
  "outlier-analysis prompt: does not contain git or gh pr operations",
  async () => {
    const content = await Deno.readTextFile(
      new URL("outlier-analysis.md", import.meta.url).pathname,
    );
    assertFalse(content.includes("git add"));
    assertFalse(content.includes("git commit"));
    assertFalse(content.includes("gh pr create"));
  },
);

Deno.test(
  "outlier-analysis prompt: writes learning entry to learnings directory",
  async () => {
    const content = await Deno.readTextFile(
      new URL("outlier-analysis.md", import.meta.url).pathname,
    );
    assertStringIncludes(content, "learnings/");
    assertStringIncludes(content, "<YYYYMMDDTHHMMSS>.md");
    assertStringIncludes(content, "id:");
    assertStringIncludes(content, "ticketId:");
    assertStringIncludes(content, "repo:");
    assertStringIncludes(content, "targetFile:");
    assertStringIncludes(content, "prTitle:");
    assertStringIncludes(content, "prBody:");
    assertFalse(content.includes('"content"'));
    assertFalse(content.includes('"intent"'));
  },
);

Deno.test(
  "outlier-analysis prompt: references State directory from context",
  async () => {
    const content = await Deno.readTextFile(
      new URL("outlier-analysis.md", import.meta.url).pathname,
    );
    assertStringIncludes(content, "State directory");
  },
);
