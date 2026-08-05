import { assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { PromptCeremony } from "./prompt.ts";

const TEST_NOW = Temporal.ZonedDateTime.from(
  "2026-07-27T10:00:00[America/New_York]",
);

function makeResponse(content: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ content }), { status });
}

function textResponse(text: string): Response {
  return makeResponse([{ type: "text", text }]);
}

function makeCeremony(
  stateDir: string,
  opts: {
    name?: string;
    appendTickLog?: (entry: object) => Promise<void>;
    fetch?: typeof globalThis.fetch;
  } = {},
): PromptCeremony {
  return new PromptCeremony({
    name: opts.name ?? "docs-gap",
    stateDir,
    anthropicApiKey: "test-key",
    appendTickLog: opts.appendTickLog ?? (() => Promise.resolve()),
    fetch: opts.fetch,
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
    await makeCeremony(stateDir, {
      name,
      fetch: () => Promise.resolve(textResponse("Output content")),
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
    await makeCeremony(stateDir, {
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

Deno.test("PromptCeremony: non-2xx API response logs ceremony-warning and writes no output", async () => {
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
    await makeCeremony(stateDir, {
      name,
      appendTickLog: (entry) => {
        warnings.push(entry);
        return Promise.resolve();
      },
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "bad" }), { status: 500 }),
        ),
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

Deno.test("PromptCeremony: model key in config.toml overrides default in API request", async () => {
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

    let sentModel: string | undefined;
    await makeCeremony(stateDir, {
      name,
      fetch: (_url, init) => {
        sentModel = JSON.parse(init?.body as string).model;
        return Promise.resolve(textResponse("output"));
      },
    }).run(TEST_NOW, join(ceremonyDir, "output"));

    assertEquals(sentModel, "claude-haiku-4-5");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("PromptCeremony: thinking = 8000 sets thinking block and max_tokens = 16192", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const name = "docs-gap";
    const ceremonyDir = join(stateDir, "ceremonies", name);
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(join(ceremonyDir, "prompt.md"), "Think about it.");
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"\nthinking = 8000',
    );

    let sentBody: Record<string, unknown> | undefined;
    await makeCeremony(stateDir, {
      name,
      fetch: (_url, init) => {
        sentBody = JSON.parse(init?.body as string);
        return Promise.resolve(textResponse("output"));
      },
    }).run(TEST_NOW, join(ceremonyDir, "output"));

    assertEquals(sentBody?.thinking, { type: "enabled", budget_tokens: 8000 });
    assertEquals(sentBody?.max_tokens, 16192);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("PromptCeremony: no thinking key in config omits thinking from request and uses max_tokens 8192", async () => {
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

    let sentBody: Record<string, unknown> | undefined;
    await makeCeremony(stateDir, {
      name,
      fetch: (_url, init) => {
        sentBody = JSON.parse(init?.body as string);
        return Promise.resolve(textResponse("output"));
      },
    }).run(TEST_NOW, join(ceremonyDir, "output"));

    assertFalse("thinking" in (sentBody ?? {}));
    assertEquals(sentBody?.max_tokens, 8192);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("PromptCeremony: only text block content written when thinking blocks present", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const name = "docs-gap";
    const ceremonyDir = join(stateDir, "ceremonies", name);
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(join(ceremonyDir, "prompt.md"), "Think deeply.");
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"\nthinking = 8000',
    );

    const outputDir = join(ceremonyDir, "output");
    await makeCeremony(stateDir, {
      name,
      fetch: () =>
        Promise.resolve(
          makeResponse([
            { type: "thinking", thinking: "internal reasoning" },
            { type: "text", text: "Final answer." },
          ]),
        ),
    }).run(TEST_NOW, outputDir);

    const files: string[] = [];
    for await (const entry of Deno.readDir(outputDir)) {
      files.push(entry.name);
    }
    assertEquals(files.length, 1);
    assertEquals(
      await Deno.readTextFile(join(outputDir, files[0])),
      "Final answer.",
    );
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
