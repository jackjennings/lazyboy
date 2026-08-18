import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { formatLargeTokens, readUsageFiles } from "./usage.ts";

Deno.test("formatLargeTokens: raw integer under 1000", () => {
  assertEquals(formatLargeTokens(0), "0");
  assertEquals(formatLargeTokens(999), "999");
});

Deno.test("formatLargeTokens: one-decimal k for 1000–999999", () => {
  assertEquals(formatLargeTokens(1000), "1.0k");
  assertEquals(formatLargeTokens(90900), "90.9k");
  assertEquals(formatLargeTokens(853600), "853.6k");
});

Deno.test("formatLargeTokens: one-decimal m for >= 1000000", () => {
  assertEquals(formatLargeTokens(1_000_000), "1.0m");
  assertEquals(formatLargeTokens(2_200_000), "2.2m");
});

Deno.test(
  "readUsageFiles: coerces legacy flat usage file to new PhaseUsage shape",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "20260715T190000-intake.usage.json"),
        JSON.stringify({
          input: 100,
          output: 50,
          cacheRead: 10,
          cacheWrite: 5,
          model: "claude-sonnet-4-6",
          durationMs: 1000,
          costUsd: 0.05,
          turns: 3,
        }),
      );
      const files = await readUsageFiles(tempDir);
      assertEquals(files?.length, 1);
      assertEquals(files![0].models.length, 1);
      assertEquals(files![0].models[0].model, "claude-sonnet-4-6");
      assertEquals(files![0].models[0].input, 100);
      assertEquals(files![0].models[0].costUsd, 0.05);
      assertEquals(files![0].durationMs, 1000);
      assertEquals(files![0].turns, 3);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);
