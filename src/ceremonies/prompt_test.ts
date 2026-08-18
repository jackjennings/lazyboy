import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { PromptCeremony } from "./prompt.ts";

const TEST_NOW = Temporal.ZonedDateTime.from(
  "2026-07-27T10:00:00[America/New_York]",
);

function makeCeremony(
  ceremonyDir: string,
  opts: {
    name?: string;
    appendTickLog?: (entry: object) => Promise<void>;
    runClaude?: (args: string[]) => Promise<{ stdout: string; code: number }>;
  } = {},
): PromptCeremony {
  return new PromptCeremony({
    name: opts.name ?? "docs-gap",
    ceremonyDir,
    appendTickLog: opts.appendTickLog ?? (() => Promise.resolve()),
    runClaude: opts.runClaude,
  });
}

Deno.test("PromptCeremony: writes output file with correct name and content", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const name = "docs-gap";
    const ceremonyDir = join(stateDir, "ceremonies", name);
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(join(ceremonyDir, "prompt.md"), "List gaps.");
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"',
    );

    const outputDir = join(ceremonyDir, "output");
    await makeCeremony(ceremonyDir, {
      name,
      runClaude: () => Promise.resolve({ stdout: "Output content\n", code: 0 }),
    }).run(TEST_NOW, outputDir);

    const files: string[] = [];
    for await (const entry of Deno.readDir(outputDir)) {
      files.push(entry.name);
    }
    assertEquals(files.length, 1);
    assertEquals(files[0], "20260727T100000-docs-gap.md");
    assertEquals(
      await Deno.readTextFile(join(outputDir, files[0])),
      "Output content",
    );
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("PromptCeremony: missing prompt.md logs ceremony-warning and writes no output", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const name = "docs-gap";
    const ceremonyDir = join(stateDir, "ceremonies", name);
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"',
    );

    const warnings: object[] = [];
    const outputDir = join(ceremonyDir, "output");
    await makeCeremony(ceremonyDir, {
      name,
      appendTickLog: (entry) => {
        warnings.push(entry);
        return Promise.resolve();
      },
    }).run(TEST_NOW, outputDir);

    assertEquals(warnings.length, 1);
    assertEquals(
      (warnings[0] as Record<string, unknown>).event,
      "ceremony-warning",
    );
    let outputExists = true;
    try {
      await Deno.stat(outputDir);
    } catch {
      outputExists = false;
    }
    assertFalse(outputExists);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("PromptCeremony: non-zero claude exit logs ceremony-warning and writes no output", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const name = "docs-gap";
    const ceremonyDir = join(stateDir, "ceremonies", name);
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(join(ceremonyDir, "prompt.md"), "Do something.");
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"',
    );

    const warnings: object[] = [];
    const outputDir = join(ceremonyDir, "output");
    await makeCeremony(ceremonyDir, {
      name,
      appendTickLog: (entry) => {
        warnings.push(entry);
        return Promise.resolve();
      },
      runClaude: () => Promise.resolve({ stdout: "", code: 1 }),
    }).run(TEST_NOW, outputDir);

    assertEquals(warnings.length, 1);
    assertEquals(
      (warnings[0] as Record<string, unknown>).event,
      "ceremony-warning",
    );
    assertEquals(
      (warnings[0] as Record<string, unknown>).reason,
      "claude-failed",
    );
    let outputExists = true;
    try {
      await Deno.stat(outputDir);
    } catch {
      outputExists = false;
    }
    assertFalse(outputExists);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("PromptCeremony: model key in config.toml passed to claude as --model arg", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const name = "docs-gap";
    const ceremonyDir = join(stateDir, "ceremonies", name);
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(join(ceremonyDir, "prompt.md"), "Do something.");
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"\nmodel = "claude-haiku-4-5"',
    );

    let capturedArgs: string[] = [];
    await makeCeremony(ceremonyDir, {
      name,
      runClaude: (args) => {
        capturedArgs = args;
        return Promise.resolve({ stdout: "output\n", code: 0 });
      },
    }).run(TEST_NOW, join(ceremonyDir, "output"));

    const modelIdx = capturedArgs.indexOf("--model");
    assertEquals(capturedArgs[modelIdx + 1], "claude-haiku-4-5");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("PromptCeremony: thinking = high passes --effort high to claude", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const name = "docs-gap";
    const ceremonyDir = join(stateDir, "ceremonies", name);
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(join(ceremonyDir, "prompt.md"), "Think about it.");
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"\nthinking = "high"',
    );

    let capturedArgs: string[] = [];
    await makeCeremony(ceremonyDir, {
      name,
      runClaude: (args) => {
        capturedArgs = args;
        return Promise.resolve({ stdout: "output\n", code: 0 });
      },
    }).run(TEST_NOW, join(ceremonyDir, "output"));

    const effortIdx = capturedArgs.indexOf("--effort");
    assertEquals(capturedArgs[effortIdx + 1], "high");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("PromptCeremony: no thinking key omits --effort from claude args", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const name = "docs-gap";
    const ceremonyDir = join(stateDir, "ceremonies", name);
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(join(ceremonyDir, "prompt.md"), "Do it.");
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"',
    );

    let capturedArgs: string[] = [];
    await makeCeremony(ceremonyDir, {
      name,
      runClaude: (args) => {
        capturedArgs = args;
        return Promise.resolve({ stdout: "output\n", code: 0 });
      },
    }).run(TEST_NOW, join(ceremonyDir, "output"));

    assertFalse(capturedArgs.includes("--effort"));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("PromptCeremony: prompt includes today's date and prompt.md content", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const name = "docs-gap";
    const ceremonyDir = join(stateDir, "ceremonies", name);
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(join(ceremonyDir, "prompt.md"), "List the gaps.");
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"',
    );

    let capturedPrompt = "";
    await makeCeremony(ceremonyDir, {
      name,
      runClaude: (args) => {
        capturedPrompt = args[0];
        return Promise.resolve({ stdout: "result\n", code: 0 });
      },
    }).run(TEST_NOW, join(ceremonyDir, "output"));

    assertStringIncludes(capturedPrompt, "2026-07-27");
    assertStringIncludes(capturedPrompt, "List the gaps.");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
