import {
  assertEquals,
  assertFalse,
  assertGreater,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  loadPromptFile,
  loadProviderPrompt,
  loadStatePrompt,
} from "./runners.ts";

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
    assertGreater(result.length, 0);
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
    assertFalse(
      content.includes("Print your response directly"),
      `${phase}.md still contains "Print your response directly"`,
    );
  }
});

Deno.test(
  "loadStatePrompt: returns file content when file exists",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/prompts`);
      await Deno.writeTextFile(
        `${dir}/prompts/intake.md`,
        "custom intake context",
      );
      const result = await loadStatePrompt("intake", dir);
      assertEquals(result, "custom intake context");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: returns empty string when file does not exist",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const result = await loadStatePrompt("intake", dir);
      assertEquals(result, "");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: propagates non-NotFound errors",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/prompts`);
      await Deno.mkdir(`${dir}/prompts/intake.md`);
      await assertRejects(() => loadStatePrompt("intake", dir));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test("phase prompts: all five phase prompts include ## Principles instruction", async () => {
  const phases = ["intake", "enrichment", "spec", "plan", "implementation"];
  for (const phase of phases) {
    const content = await loadPromptFile(`${phase}.md`);
    assertStringIncludes(
      content,
      "## Principles",
      `${phase}.md does not include ## Principles instruction`,
    );
  }
});

Deno.test(
  "loadStatePrompt: expands {{principles}} to include ## Principles",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/prompts`);
      await Deno.writeTextFile(`${dir}/prompts/intake.md`, "{{principles}}");
      const result = await loadStatePrompt("intake", dir);
      assertStringIncludes(result, "## Principles");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: rejects when prompt references unknown partial",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/prompts`);
      await Deno.writeTextFile(`${dir}/prompts/intake.md`, "{{nonexistent}}");
      await assertRejects(() => loadStatePrompt("intake", dir));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: returns content unchanged when no markers present",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/prompts`);
      await Deno.writeTextFile(`${dir}/prompts/intake.md`, "plain content");
      const result = await loadStatePrompt("intake", dir);
      assertEquals(result, "plain content");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

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
    assertStringIncludes(
      content,
      "output file path",
      `${phase}.md does not mention "output file path"`,
    );
  }
});
