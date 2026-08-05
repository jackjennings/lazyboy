import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { aggregateUsage, formatUsageOutput, usage } from "./usage.ts";
import type { PhaseUsage } from "../state/types.ts";

function makeUsage(
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  costUsd?: number,
): PhaseUsage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    model,
    durationMs: 0,
    costUsd,
  };
}

// ── aggregateUsage ─────────────────────────────────────────────────────────────

Deno.test("aggregateUsage: returns empty map for empty input", () => {
  assertEquals(aggregateUsage([]).size, 0);
});

Deno.test("aggregateUsage: strips date suffix from model name", () => {
  const result = aggregateUsage([
    makeUsage("claude-haiku-4-5-20251001", 1, 1, 0, 0),
  ]);
  assert(result.has("claude-haiku-4-5"));
  assertFalse(result.has("claude-haiku-4-5-20251001"));
});

Deno.test("aggregateUsage: groups by stripped model name and sums token fields", () => {
  const result = aggregateUsage([
    makeUsage("claude-haiku-4-5-20251001", 10, 5, 100, 50),
    makeUsage("claude-haiku-4-5-20260101", 20, 8, 200, 30),
  ]);
  assertEquals(result.size, 1);
  const g = result.get("claude-haiku-4-5")!;
  assertEquals(g.input, 30);
  assertEquals(g.output, 13);
  assertEquals(g.cacheRead, 300);
  assertEquals(g.cacheWrite, 80);
});

Deno.test("aggregateUsage: tracks costCount — none have cost", () => {
  const result = aggregateUsage([makeUsage("claude-haiku-4-5", 1, 1, 0, 0)]);
  const g = result.get("claude-haiku-4-5")!;
  assertEquals(g.count, 1);
  assertEquals(g.costCount, 0);
});

Deno.test("aggregateUsage: tracks costCount — all have cost", () => {
  const result = aggregateUsage([
    makeUsage("claude-haiku-4-5", 1, 1, 0, 0, 0.50),
    makeUsage("claude-haiku-4-5", 2, 2, 0, 0, 0.75),
  ]);
  const g = result.get("claude-haiku-4-5")!;
  assertEquals(g.count, 2);
  assertEquals(g.costCount, 2);
  assertEquals(g.cost, 1.25);
});

Deno.test("aggregateUsage: tracks costCount — some have cost", () => {
  const result = aggregateUsage([
    makeUsage("claude-haiku-4-5", 1, 1, 0, 0, 0.50),
    makeUsage("claude-haiku-4-5", 2, 2, 0, 0),
  ]);
  const g = result.get("claude-haiku-4-5")!;
  assertEquals(g.count, 2);
  assertEquals(g.costCount, 1);
});

// ── formatUsageOutput ──────────────────────────────────────────────────────────

Deno.test("formatUsageOutput: empty state line when no groups", () => {
  assertEquals(formatUsageOutput(new Map()), "Total cost:  —");
});

Deno.test("formatUsageOutput: em-dash total cost when no records have cost", () => {
  const groups = aggregateUsage([makeUsage("claude-haiku-4-5", 541, 23, 0, 0)]);
  assertStringIncludes(formatUsageOutput(groups).split("\n")[0], "—");
});

Deno.test("formatUsageOutput: exact total cost when all records have cost", () => {
  const groups = aggregateUsage([
    makeUsage("claude-haiku-4-5", 541, 23, 0, 0, 8.71),
  ]);
  const line0 = formatUsageOutput(groups).split("\n")[0];
  assertStringIncludes(line0, "$8.71");
  assertFalse(line0.includes("~"));
});

Deno.test("formatUsageOutput: tilde total cost when some records have cost", () => {
  const groups = aggregateUsage([
    makeUsage("claude-haiku-4-5", 1, 1, 0, 0, 1.00),
    makeUsage("claude-opus-4-8", 1, 1, 0, 0),
  ]);
  assertStringIncludes(formatUsageOutput(groups).split("\n")[0], "~$1.00");
});

Deno.test("formatUsageOutput: aligns value column at max name length + 7", () => {
  const groups = aggregateUsage([
    makeUsage("claude-haiku-4-5-20251001", 541, 23, 0, 0, 0.50),
    makeUsage("claude-opus-4-8-20261001", 86, 90900, 2200000, 853600, 8.21),
  ]);
  const lines = formatUsageOutput(groups).split("\n");
  assertEquals(lines[0], "Total cost:            $8.71");
});

Deno.test("formatUsageOutput: right-aligns shorter model names within max width", () => {
  const groups = aggregateUsage([
    makeUsage("claude-haiku-4-5-20251001", 541, 23, 0, 0, 0.50),
    makeUsage("claude-opus-4-8-20261001", 86, 0, 0, 0, 8.21),
  ]);
  const lines = formatUsageOutput(groups).split("\n");
  assertStringIncludes(lines[2], "    claude-haiku-4-5:  ");
  assertStringIncludes(lines[3], "     claude-opus-4-8:  ");
});

Deno.test("formatUsageOutput: sorts models alphabetically", () => {
  const groups = aggregateUsage([
    makeUsage("claude-opus-4-8", 1, 1, 0, 0),
    makeUsage("claude-haiku-4-5", 1, 1, 0, 0),
  ]);
  const lines = formatUsageOutput(groups).split("\n");
  assertStringIncludes(lines[2], "claude-haiku-4-5");
  assertStringIncludes(lines[3], "claude-opus-4-8");
});

Deno.test("formatUsageOutput: exact per-model cost when all records have cost", () => {
  const groups = aggregateUsage([
    makeUsage("claude-haiku-4-5", 1, 1, 0, 0, 1.23),
  ]);
  assertStringIncludes(formatUsageOutput(groups), "($1.23)");
});

Deno.test("formatUsageOutput: tilde per-model cost when some records lack cost", () => {
  const groups = aggregateUsage([
    makeUsage("claude-haiku-4-5", 1, 1, 0, 0, 1.23),
    makeUsage("claude-haiku-4-5", 1, 1, 0, 0),
  ]);
  assertStringIncludes(formatUsageOutput(groups), "(~$1.23)");
});

Deno.test("formatUsageOutput: em-dash per-model cost when no records have cost", () => {
  const groups = aggregateUsage([makeUsage("claude-haiku-4-5", 1, 1, 0, 0)]);
  assertStringIncludes(formatUsageOutput(groups), "(—)");
});

Deno.test("formatUsageOutput: m suffix for million-range token counts", () => {
  const groups = aggregateUsage([
    makeUsage("claude-opus-4-8", 0, 0, 2_200_000, 0),
  ]);
  assertStringIncludes(formatUsageOutput(groups), "2.2m cache read");
});

// ── usage command ─────────────────────────────────────────────────────────────

Deno.test("usage command name is 'usage'", () => {
  assertEquals(usage.name, "usage");
});

Deno.test("usage command reads usage files from all ticket directories", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ticketDir = join(stateDir, "github", "a", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(ticketDir, "20260715T190000-intake.usage.json"),
      JSON.stringify(makeUsage("claude-haiku-4-5-20251001", 10, 5, 0, 0, 0.01)),
    );

    const originalEnv = Deno.env.get("HOME");
    const fakeHome = await Deno.makeTempDir();
    Deno.env.set("HOME", fakeHome);
    const configDir = join(fakeHome, ".config", "lazyboy");
    await Deno.mkdir(configDir, { recursive: true });
    await Deno.writeTextFile(
      join(configDir, "config.toml"),
      `[github]\nrepos = []\n\n[state]\ndir = "${stateDir}"\n`,
    );

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (s: string) => lines.push(s);
    try {
      await usage.run([]);
    } finally {
      console.log = origLog;
      if (originalEnv !== undefined) Deno.env.set("HOME", originalEnv);
      else Deno.env.delete("HOME");
      await Deno.remove(fakeHome, { recursive: true });
    }
    assertEquals(lines.length, 1);
    assertStringIncludes(lines[0], "claude-haiku-4-5");
    assertStringIncludes(lines[0], "$0.01");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
