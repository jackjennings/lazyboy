import { assert, assertStringIncludes } from "@std/assert";
import { loadPromptFile } from "../runners.ts";

Deno.test(
  "implementation-revision prompt instructs agent to run gh pr edit for open PRs",
  async () => {
    const content = await loadPromptFile("implementation-revision.md");
    assertStringIncludes(content, "gh pr edit");
  },
);

Deno.test(
  "implementation-revision prompt instructs agent to skip merged or closed PRs",
  async () => {
    const content = await loadPromptFile("implementation-revision.md");
    assertStringIncludes(content, "merged");
    assertStringIncludes(content, "closed");
  },
);

Deno.test(
  "implementation-revision prompt instructs agent to include the issue URL in the PR description",
  async () => {
    const content = await loadPromptFile("implementation-revision.md");
    assertStringIncludes(content, "url");
  },
);

Deno.test(
  "implementation-revision prompt instructs agent to do nothing when ticket.prs is empty or all merged/closed",
  async () => {
    const content = await loadPromptFile("implementation-revision.md");
    assert(content.includes("prs") && content.includes("nothing"));
  },
);
