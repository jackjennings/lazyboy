import {
  assertEquals,
  assertFalse,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { dim, stripAnsiCode } from "@std/fmt/colors";
import {
  formatHudHeader,
  formatTickLogLine,
  logPaneLines,
  openLogWatch,
} from "./hud.ts";

// ── formatTickLogLine ─────────────────────────────────────────────────────────

Deno.test("formatTickLogLine: formats time", () => {
  const line = formatTickLogLine(
    '{"ts":"2026-07-29T12:00:00Z","event":"tick-failed","error":"oh no"}',
  );
  assertMatch(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assertStringIncludes(line, "tick-failed");
  assertStringIncludes(line, "error=oh no");
});

Deno.test("formatTickLogLine: excludes ts and event from key=value pairs", () => {
  const line = formatTickLogLine(
    '{"ts":"2026-07-29T12:00:00Z","event":"tick-failed"}',
  );
  assertFalse(line.includes("ts="));
  assertFalse(line.includes("event="));
});

Deno.test("formatTickLogLine: no trailing key=value when no extra fields", () => {
  const line = formatTickLogLine(
    '{"ts":"2026-07-29T12:00:00Z","event":"tick-already-running"}',
  );
  const parts = line.trim().split(" ");
  assertEquals(parts.length, 3); // timestamp + event
});

Deno.test("formatTickLogLine: returns verbatim string on JSON parse failure", () => {
  assertEquals(formatTickLogLine("not json"), "not json");
});

Deno.test("formatTickLogLine: renders id field from combined log entry", () => {
  const line = formatTickLogLine(
    '{"ts":"2026-07-29T12:00:00Z","id":"github/jackjennings/lazyboy/258","event":"status-transition","from":"new","to":"running"}',
  );
  assertStringIncludes(line, "status-transition");
  assertStringIncludes(line, "github/jackjennings/lazyboy/258");
  assertStringIncludes(line, "from=new");
});

Deno.test("formatTickLogLine: renders id second", () => {
  const line = formatTickLogLine(
    '{"ts":"2026-07-29T12:00:00Z","id":"github/jackjennings/lazyboy/258","event":"tick-already-running"}',
  );
  assertEquals(line.split(" ", 3)[1], "github/jackjennings/lazyboy/258");
});

Deno.test("formatTickLogLine: renders context with event", () => {
  const line = formatTickLogLine(
    '{"ts":"2026-07-29T12:00:00Z","id":"github/jackjennings/lazyboy/258","event":"failure","context":"agent"}',
  );
  assertEquals(line.split(" ", 3)[2], "agent/failure");
});

// ── formatHudHeader ───────────────────────────────────────────────────────────

Deno.test("formatHudHeader: shows enabled badge when enabled is true", () => {
  const line = formatHudHeader(true, 2, 5);
  assertStringIncludes(stripAnsiCode(line), "enabled");
  assertStringIncludes(line, "2/5 running");
});

Deno.test("formatHudHeader: shows disabled badge when enabled is false", () => {
  const line = formatHudHeader(false, 0, 5);
  assertStringIncludes(stripAnsiCode(line), "disabled");
  assertStringIncludes(line, "0/5 running");
});

// ── logPaneLines ──────────────────────────────────────────────────────────────

Deno.test("logPaneLines: returns dim placeholder when lines is empty", () => {
  assertEquals(logPaneLines([]), [dim("(no logs)")]);
});

Deno.test("logPaneLines: passes through non-empty lines unchanged", () => {
  const lines = ["12:00:00 tick-failed"];
  assertEquals(logPaneLines(lines), lines);
});

// ── openLogWatch ──────────────────────────────────────────────────────────────

Deno.test("openLogWatch: resolves when log.ndjson does not exist", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const watcher = await openLogWatch(tmpDir);
    watcher.close();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
