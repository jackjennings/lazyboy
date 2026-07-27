import { assertEquals } from "@std/assert";
import { loadPromptFile, loadProviderPrompt } from "./runners.ts";

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
  },
);

Deno.test("phase prompts: no prompt instructs the agent to print its response", async () => {
  const phases = [
    "intake",
    "enrichment",
    "spec",
    "plan",
    "implementation",
    "implementation-revision",
  ];
  for (const phase of phases) {
    const content = await loadPromptFile(`${phase}.md`);
    assertEquals(
      content.includes("Print your response directly"),
      false,
      `${phase}.md still contains "Print your response directly"`,
    );
  }
});

Deno.test("phase prompts: every prompt instructs the agent to write to the output file", async () => {
  const phases = [
    "intake",
    "enrichment",
    "spec",
    "plan",
    "implementation",
    "implementation-revision",
  ];
  for (const phase of phases) {
    const content = await loadPromptFile(`${phase}.md`);
    assertEquals(
      content.includes("output file path"),
      true,
      `${phase}.md does not mention "output file path"`,
    );
  }
});
