import { assertEquals } from "@std/assert";
import { loadPromptFile } from "../runners.ts";

Deno.test(
  "implementation-revision prompt instructs agent to run gh pr edit for open PRs",
  async () => {
    const content = await loadPromptFile("implementation-revision.md");
    assertEquals(content.includes("gh pr edit"), true);
  },
);

Deno.test(
  "implementation-revision prompt instructs agent to skip merged or closed PRs",
  async () => {
    const content = await loadPromptFile("implementation-revision.md");
    assertEquals(content.includes("merged"), true);
    assertEquals(content.includes("closed"), true);
  },
);

Deno.test(
  "implementation-revision prompt instructs agent to include the issue URL in the PR description",
  async () => {
    const content = await loadPromptFile("implementation-revision.md");
    assertEquals(content.includes("url"), true);
  },
);

Deno.test(
  "implementation-revision prompt instructs agent to do nothing when ticket.prs is empty or all merged/closed",
  async () => {
    const content = await loadPromptFile("implementation-revision.md");
    assertEquals(content.includes("prs") && content.includes("nothing"), true);
  },
);
