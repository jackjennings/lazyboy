import { assertEquals } from "@std/assert";
import { loadProviderPrompt } from "./runners.ts";

Deno.test(
  "loadProviderPrompt: returns empty string when supplement file is absent",
  async () => {
    const result = await loadProviderPrompt("intake", "github");
    assertEquals(result, "");
  },
);

Deno.test(
  "loadProviderPrompt: returns file content when supplement file exists",
  async () => {
    const result = await loadProviderPrompt("implementation", "github");
    assertEquals(result.length > 0, true);
    assertEquals(result.includes("gh pr create"), false);
  },
);
