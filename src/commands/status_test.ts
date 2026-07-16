import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  formatStatusHeader,
  formatStatusRow,
  formatTokens,
  readTicketTokens,
} from "./status.ts";

// ── formatTokens ─────────────────────────────────────────────────────────────

Deno.test("formatTokens: returns em-dash for null", () => {
  assertEquals(formatTokens(null), "—");
});

Deno.test("formatTokens: returns plain integer string for totals under 1000", () => {
  assertEquals(formatTokens(0), "0");
  assertEquals(formatTokens(999), "999");
  assertEquals(formatTokens(500), "500");
});

Deno.test("formatTokens: returns Xk with one decimal for totals >= 1000", () => {
  assertEquals(formatTokens(1000), "1.0k");
  assertEquals(formatTokens(3300), "3.3k");
  assertEquals(formatTokens(3350), "3.4k");
  assertEquals(formatTokens(10000), "10.0k");
});

// ── readTicketTokens ─────────────────────────────────────────────────────────

Deno.test("readTicketTokens: returns null when no usage files exist", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const result = await readTicketTokens(tempDir);
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "readTicketTokens: sums all four token fields across all usage files",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "20260715T190000-intake.usage.json"),
        JSON.stringify({
          input: 10,
          output: 5,
          cacheRead: 100,
          cacheWrite: 50,
          model: "claude-sonnet-4-6",
          durationMs: 1000,
        }),
      );
      await Deno.writeTextFile(
        join(tempDir, "20260715T192000-enrichment.usage.json"),
        JSON.stringify({
          input: 20,
          output: 8,
          cacheRead: 200,
          cacheWrite: 30,
          model: "claude-sonnet-4-6",
          durationMs: 2000,
        }),
      );
      const result = await readTicketTokens(tempDir);
      assertEquals(result, 10 + 5 + 100 + 50 + 20 + 8 + 200 + 30);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "readTicketTokens: returns null when usage files cannot be parsed",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "20260715T190000-intake.usage.json"),
        "not-json",
      );
      const result = await readTicketTokens(tempDir);
      assertEquals(result, null);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test("readTicketTokens: ignores non-usage json files", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260715T190000-intake.usage.json"),
      JSON.stringify({
        input: 5,
        output: 3,
        cacheRead: 20,
        cacheWrite: 10,
        model: "claude-sonnet-4-6",
        durationMs: 500,
      }),
    );
    const result = await readTicketTokens(tempDir);
    assertEquals(result, 38);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ── formatStatusRow / formatStatusHeader ─────────────────────────────────────

Deno.test("formatStatusRow: pads ID field to 36 characters", () => {
  const row = formatStatusRow(
    "github/jackjennings/lazyboy/23",
    "intake",
    "running",
    false,
    "0",
    "My ticket",
  );
  assertEquals(row.startsWith("github/jackjennings/lazyboy/23      "), true);
});

Deno.test("formatStatusHeader: separator line is 117 characters", () => {
  const lines = formatStatusHeader().split("\n");
  assertEquals(lines[1].length, 117);
});
