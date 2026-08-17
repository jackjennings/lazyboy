import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertFalse,
  assertGreater,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import {
  loadArtifactPrompt,
  loadPromptFile,
  loadProviderPrompt,
  loadRevisionPrompt,
  loadStatePrompt,
} from "./runners.ts";

Deno.test(
  "loadProviderPrompt: returns empty content when supplement file is absent",
  async () => {
    const result = await loadProviderPrompt("intake", "github");
    assertEquals(result.content, "");
  },
);

Deno.test(
  "loadProviderPrompt: returns file content when supplement file exists",
  async () => {
    const result = await loadProviderPrompt("implementation", "github");
    assertGreater(result.content.length, 0);
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
    "spec-revision",
    "plan-revision",
  ];
  for (const phase of phases) {
    const { content } = await loadPromptFile(`${phase}.md`);
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
      assertEquals(result.content, "custom intake context");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: returns empty content when file does not exist",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const result = await loadStatePrompt("intake", dir);
      assertEquals(result.content, "");
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
    const { content } = await loadPromptFile(`${phase}.md`);
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
      assertStringIncludes(result.content, "## Principles");
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
      assertEquals(result.content, "plain content");
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
    const { content } = await loadPromptFile(`${phase}.md`);
    assertStringIncludes(
      content,
      "output file path",
      `${phase}.md does not mention "output file path"`,
    );
  }
});

Deno.test(
  "loadStatePrompt: includes provider-level content when provider and id provided",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "prompts", "github"), { recursive: true });
      await Deno.writeTextFile(join(dir, "prompts", "spec.md"), "");
      await Deno.writeTextFile(
        join(dir, "prompts", "github", "spec.md"),
        "github supplement",
      );
      const result = await loadStatePrompt(
        "spec",
        dir,
        "github",
        "github/jackjennings/lazyboy/295",
      );
      assertEquals(result.content, "github supplement");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: concatenates top-level and provider-level with double newline",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "prompts", "github"), { recursive: true });
      await Deno.writeTextFile(join(dir, "prompts", "spec.md"), "top");
      await Deno.writeTextFile(
        join(dir, "prompts", "github", "spec.md"),
        "provider",
      );
      const result = await loadStatePrompt(
        "spec",
        dir,
        "github",
        "github/jackjennings/lazyboy/295",
      );
      assertEquals(result.content, "top\n\nprovider");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: includes project-level content for github ticket",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(
        join(dir, "prompts", "github", "jackjennings", "lazyboy"),
        { recursive: true },
      );
      await Deno.writeTextFile(
        join(dir, "prompts", "github", "jackjennings", "lazyboy", "spec.md"),
        "repo specific",
      );
      const result = await loadStatePrompt(
        "spec",
        dir,
        "github",
        "github/jackjennings/lazyboy/295",
      );
      assertEquals(result.content, "repo specific");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: concatenates all three levels in order",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(
        join(dir, "prompts", "github", "jackjennings", "lazyboy"),
        { recursive: true },
      );
      await Deno.writeTextFile(join(dir, "prompts", "spec.md"), "top");
      await Deno.writeTextFile(
        join(dir, "prompts", "github", "spec.md"),
        "provider",
      );
      await Deno.writeTextFile(
        join(dir, "prompts", "github", "jackjennings", "lazyboy", "spec.md"),
        "project",
      );
      const result = await loadStatePrompt(
        "spec",
        dir,
        "github",
        "github/jackjennings/lazyboy/295",
      );
      assertEquals(result.content, "top\n\nprovider\n\nproject");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: extracts jira board prefix for project-level path",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "prompts", "jira", "FOO"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(dir, "prompts", "jira", "FOO", "spec.md"),
        "jira board content",
      );
      const result = await loadStatePrompt(
        "spec",
        dir,
        "jira",
        "jira/FOO-123",
      );
      assertEquals(result.content, "jira board content");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: skips absent provider/project files silently",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "prompts"), { recursive: true });
      await Deno.writeTextFile(join(dir, "prompts", "spec.md"), "top only");
      const result = await loadStatePrompt(
        "spec",
        dir,
        "github",
        "github/jackjennings/lazyboy/295",
      );
      assertEquals(result.content, "top only");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: returns empty content when all levels absent",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const result = await loadStatePrompt(
        "spec",
        dir,
        "github",
        "github/jackjennings/lazyboy/295",
      );
      assertEquals(result.content, "");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: empty files at any level contribute nothing to result",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(
        join(dir, "prompts", "github", "jackjennings", "lazyboy"),
        { recursive: true },
      );
      await Deno.writeTextFile(join(dir, "prompts", "spec.md"), "");
      await Deno.writeTextFile(
        join(dir, "prompts", "github", "spec.md"),
        "provider",
      );
      await Deno.writeTextFile(
        join(dir, "prompts", "github", "jackjennings", "lazyboy", "spec.md"),
        "",
      );
      const result = await loadStatePrompt(
        "spec",
        dir,
        "github",
        "github/jackjennings/lazyboy/295",
      );
      assertEquals(result.content, "provider");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: two-arg form unchanged (no provider/id → top-level only)",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "prompts"), { recursive: true });
      await Deno.writeTextFile(join(dir, "prompts", "intake.md"), "top only");
      const result = await loadStatePrompt("intake", dir);
      assertEquals(result.content, "top only");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadArtifactPrompt: returns empty content when no artifact has a prompt file",
  async () => {
    const result = await loadArtifactPrompt("spec", ["code"]);
    assertEquals(result.content.length, 0);
  },
);

Deno.test("loadArtifactPrompt: document-spec returns non-empty content", async () => {
  const result = await loadArtifactPrompt("spec", ["document"]);
  assertGreater(result.content.length, 0);
});

Deno.test("loadArtifactPrompt: document-plan returns non-empty content", async () => {
  const result = await loadArtifactPrompt("plan", ["document"]);
  assertGreater(result.content.length, 0);
});

Deno.test(
  "loadArtifactPrompt: document-implementation returns non-empty content",
  async () => {
    const result = await loadArtifactPrompt("implementation", ["document"]);
    assertGreater(result.content.length, 0);
  },
);

Deno.test(
  "loadArtifactPrompt: concatenates per-artifact prompts for multi-artifact array",
  async () => {
    const single = await loadArtifactPrompt("spec", ["document"]);
    const multi = await loadArtifactPrompt("spec", ["code", "document"]);
    assertEquals(multi.content, single.content);
    assertGreater(multi.content.length, 0);
  },
);

Deno.test(
  "loadRevisionPrompt: returns file content when revision file exists",
  async () => {
    const result = await loadRevisionPrompt("spec");
    assertGreater(result.content.length, 0);
  },
);

Deno.test(
  "loadRevisionPrompt: returns empty content when no revision file exists",
  async () => {
    const result = await loadRevisionPrompt("unknown-xyz-revision-test");
    assertEquals(result.content, "");
  },
);

Deno.test(
  "loadRevisionPrompt: propagates non-NotFound errors",
  async () => {
    const error = new Deno.errors.PermissionDenied("test");
    const readStub = stub(Deno, "readTextFile", () => Promise.reject(error));
    try {
      await assertRejects(
        () => loadRevisionPrompt("spec"),
        Deno.errors.PermissionDenied,
      );
    } finally {
      readStub.restore();
    }
  },
);

Deno.test(
  "loadStatePrompt: returns notion in partials when partial marker present",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/prompts`);
      await Deno.writeTextFile(`${dir}/prompts/intake.md`, "{{notion}}");
      const result = await loadStatePrompt("intake", dir);
      assertArrayIncludes(result.partials, ["notion"]);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadStatePrompt: partials from multiple levels are combined",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "prompts", "github"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, "prompts", "spec.md"),
        "{{notion}}",
      );
      await Deno.writeTextFile(
        join(dir, "prompts", "github", "spec.md"),
        "{{principles}}",
      );
      const result = await loadStatePrompt(
        "spec",
        dir,
        "github",
        "github/jackjennings/lazyboy/295",
      );
      assertArrayIncludes(result.partials, ["notion"]);
      assertArrayIncludes(result.partials, ["principles"]);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "loadPromptFile: returns partials array alongside content",
  async () => {
    const result = await loadPromptFile("intake.md");
    assertEquals(typeof result.content, "string");
    assert(Array.isArray(result.partials));
  },
);
