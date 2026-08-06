import { assertFalse, assertStringIncludes } from "@std/assert";

Deno.test(
  "plan prompt uses language-agnostic example in spec-reference instruction",
  async () => {
    const content = await Deno.readTextFile(
      new URL("plan.md", import.meta.url).pathname,
    );
    assertFalse(content.includes("file.ts"));
  },
);

Deno.test(
  "plan prompt uses language-agnostic file extensions in test discovery command",
  async () => {
    const content = await Deno.readTextFile(
      new URL("plan.md", import.meta.url).pathname,
    );
    assertFalse(content.includes("'*_test.ts'"));
    assertStringIncludes(content, "'*_test.*'");
  },
);
