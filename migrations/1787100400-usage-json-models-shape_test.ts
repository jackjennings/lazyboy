import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import migration from "./1787100400-usage-json-models-shape.ts";

Deno.test(
  "migration usage-json-models-shape: converts old flat usage file to models array",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const ticketDir = join(dir, "github", "org", "repo", "1");
      await Deno.mkdir(ticketDir, { recursive: true });
      const old = {
        model: "claude-sonnet-4-6",
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheWrite: 5,
        durationMs: 1000,
        turns: 3,
        costUsd: 0.01,
      };
      await Deno.writeTextFile(
        join(ticketDir, "20260818T120000-implementation.usage.json"),
        JSON.stringify(old),
      );
      await migration.run(dir);
      const raw = await Deno.readTextFile(
        join(ticketDir, "20260818T120000-implementation.usage.json"),
      );
      const parsed = JSON.parse(raw);
      assertEquals(parsed.durationMs, 1000);
      assertEquals(parsed.turns, 3);
      assertEquals(Array.isArray(parsed.models), true);
      assertEquals(parsed.models.length, 1);
      assertEquals(parsed.models[0].model, "claude-sonnet-4-6");
      assertEquals(parsed.models[0].input, 100);
      assertEquals(parsed.models[0].output, 50);
      assertEquals(parsed.models[0].cacheRead, 10);
      assertEquals(parsed.models[0].cacheWrite, 5);
      assertEquals(parsed.models[0].costUsd, 0.01);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "migration usage-json-models-shape: leaves new-format usage file unchanged",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const ticketDir = join(dir, "github", "org", "repo", "2");
      await Deno.mkdir(ticketDir, { recursive: true });
      const newFormat = {
        durationMs: 2000,
        turns: 5,
        models: [
          {
            model: "claude-sonnet-4-6",
            input: 200,
            output: 100,
            cacheRead: 20,
            cacheWrite: 10,
            costUsd: 0.02,
          },
          {
            model: "claude-haiku-4-5",
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
          },
        ],
      };
      await Deno.writeTextFile(
        join(ticketDir, "20260818T120000-ci-fix.usage.json"),
        JSON.stringify(newFormat),
      );
      await migration.run(dir);
      const raw = await Deno.readTextFile(
        join(ticketDir, "20260818T120000-ci-fix.usage.json"),
      );
      const parsed = JSON.parse(raw);
      assertEquals(parsed.models.length, 2);
      assertEquals(parsed.models[0].model, "claude-sonnet-4-6");
      assertEquals(parsed.models[1].model, "claude-haiku-4-5");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "migration usage-json-models-shape: old file without costUsd omits costUsd in output",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const ticketDir = join(dir, "github", "org", "repo", "3");
      await Deno.mkdir(ticketDir, { recursive: true });
      const old = {
        model: "claude-haiku-4-5",
        input: 50,
        output: 25,
        cacheRead: 0,
        cacheWrite: 0,
        durationMs: 500,
      };
      await Deno.writeTextFile(
        join(ticketDir, "20260818T120000-intake.usage.json"),
        JSON.stringify(old),
      );
      await migration.run(dir);
      const raw = await Deno.readTextFile(
        join(ticketDir, "20260818T120000-intake.usage.json"),
      );
      const parsed = JSON.parse(raw);
      assertEquals("costUsd" in parsed.models[0], false);
      assertEquals("turns" in parsed, false);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "migration usage-json-models-shape: ignores non-usage files",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const ticketDir = join(dir, "github", "org", "repo", "4");
      await Deno.mkdir(ticketDir, { recursive: true });
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\nid: x\n---");
      await Deno.writeTextFile(
        join(ticketDir, "20260818T120000-implementation.md"),
        "output",
      );
      await migration.run(dir);
      const meta = await Deno.readTextFile(join(ticketDir, "meta.md"));
      assertEquals(meta, "---\nid: x\n---");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
