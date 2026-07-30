import { assertEquals } from "@std/assert";

Deno.test(
  "plan-outlier-analysis prompt: does not contain git or gh pr operations",
  async () => {
    const content = await Deno.readTextFile(
      new URL("plan-outlier-analysis.md", import.meta.url).pathname,
    );
    assertEquals(content.includes("git add"), false);
    assertEquals(content.includes("git commit"), false);
    assertEquals(content.includes("gh pr create"), false);
  },
);

Deno.test(
  "plan-outlier-analysis prompt: writes learning entry to learnings directory",
  async () => {
    const content = await Deno.readTextFile(
      new URL("plan-outlier-analysis.md", import.meta.url).pathname,
    );
    assertEquals(content.includes("learnings/"), true);
    assertEquals(content.includes("<YYYYMMDDTHHMMSS>.md"), true);
    assertEquals(content.includes("id:"), true);
    assertEquals(content.includes("ticketId:"), true);
    assertEquals(content.includes("repo:"), true);
    assertEquals(content.includes("targetFile:"), true);
    assertEquals(content.includes("prTitle:"), true);
    assertEquals(content.includes("prBody:"), true);
    assertEquals(content.includes('"content"'), false);
    assertEquals(content.includes('"intent"'), false);
  },
);

Deno.test(
  "plan-outlier-analysis prompt: references State directory from context",
  async () => {
    const content = await Deno.readTextFile(
      new URL("plan-outlier-analysis.md", import.meta.url).pathname,
    );
    assertEquals(content.includes("State directory"), true);
  },
);
