import { assertFalse, assertStringIncludes } from "@std/assert";

Deno.test(
  "plan-outlier-analysis prompt does not hardcode lazyboy repo slug as PR target",
  async () => {
    const content = await Deno.readTextFile(
      new URL("plan-outlier-analysis.md", import.meta.url).pathname,
    );
    assertFalse(content.includes("against `jackjennings/lazyboy`"));
    assertStringIncludes(content, "in the current repository");
  },
);
