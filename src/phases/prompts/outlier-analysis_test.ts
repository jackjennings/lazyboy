import { assertEquals } from "@std/assert";

Deno.test(
  "outlier-analysis prompt: does not contain git or gh pr operations",
  async () => {
    const content = await Deno.readTextFile(
      new URL("outlier-analysis.md", import.meta.url).pathname,
    );
    assertEquals(content.includes("git add"), false);
    assertEquals(content.includes("git commit"), false);
    assertEquals(content.includes("gh pr create"), false);
  },
);

Deno.test(
  "outlier-analysis prompt: writes learning entry to learnings directory",
  async () => {
    const content = await Deno.readTextFile(
      new URL("outlier-analysis.md", import.meta.url).pathname,
    );
    assertEquals(content.includes("learnings/"), true);
    assertEquals(content.includes('"id"'), true);
    assertEquals(content.includes('"ticketId"'), true);
    assertEquals(content.includes('"repo"'), true);
    assertEquals(content.includes('"targetFile"'), true);
    assertEquals(content.includes('"content"'), true);
    assertEquals(content.includes('"prTitle"'), true);
    assertEquals(content.includes('"prBody"'), true);
  },
);

Deno.test(
  "outlier-analysis prompt: references State directory from context",
  async () => {
    const content = await Deno.readTextFile(
      new URL("outlier-analysis.md", import.meta.url).pathname,
    );
    assertEquals(content.includes("State directory"), true);
  },
);
