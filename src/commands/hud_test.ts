import {
  assert,
  assertEquals,
  assertFalse,
  assertGreater,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { dim, stripAnsiCode } from "@std/fmt/colors";
import {
  formatHudHeader,
  formatTickLogLine,
  isBlockedCommand,
  logPaneLines,
  openLogWatch,
  parseCommand,
  readTickLog,
  TICK_LOG_TAIL_LINES,
} from "./hud.ts";

// ── formatTickLogLine ─────────────────────────────────────────────────────────

Deno.test("formatTickLogLine: formats time", () => {
  const line = formatTickLogLine(
    '{"ts":"2026-07-29T12:00:00Z","event":"tick-failed","error":"oh no"}',
  );
  assertMatch(stripAnsiCode(line), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
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
  assertEquals(
    stripAnsiCode(line).split(" ", 3)[1],
    "github/jackjennings/lazyboy/258",
  );
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

// ── readTickLog ───────────────────────────────────────────────────────────────

async function writeTickLog(count: number): Promise<string> {
  const dir = await Deno.makeTempDir();
  const path = join(dir, "log.ndjson");
  const lines = Array.from(
    { length: count },
    (_, i) =>
      `{"ts":"2026-07-29T12:00:00Z","event":"tick-failed","index":${i}}`,
  );
  await Deno.writeTextFile(path, lines.join("\n") + "\n");
  return path;
}

Deno.test("readTickLog: returns no lines when the file is missing", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await readTickLog(join(dir, "log.ndjson")), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readTickLog: returns every line for a short log", async () => {
  const path = await writeTickLog(3);
  try {
    const lines = await readTickLog(path);
    assertEquals(lines.length, 3);
    assertStringIncludes(lines[0], "index=0");
  } finally {
    await Deno.remove(dirname(path), { recursive: true });
  }
});

Deno.test("readTickLog: caps a long log at the tail line limit", async () => {
  const path = await writeTickLog(TICK_LOG_TAIL_LINES + 500);
  try {
    const lines = await readTickLog(path);
    assertEquals(lines.length, TICK_LOG_TAIL_LINES);
  } finally {
    await Deno.remove(dirname(path), { recursive: true });
  }
});

Deno.test("readTickLog: keeps the most recent lines of a long log", async () => {
  const total = TICK_LOG_TAIL_LINES + 500;
  const path = await writeTickLog(total);
  try {
    const lines = await readTickLog(path);
    assertStringIncludes(lines[lines.length - 1], `index=${total - 1}`);
  } finally {
    await Deno.remove(dirname(path), { recursive: true });
  }
});

Deno.test("readTickLog: drops the partial line at a byte-truncated tail", async () => {
  const dir = await Deno.makeTempDir();
  const path = join(dir, "log.ndjson");
  try {
    const filler = Array.from(
      { length: 40 },
      (_, i) =>
        `{"ts":"2026-07-29T12:00:00Z","event":"tick-failed","pad":"${
          "x".repeat(20_000)
        }","index":${i}}`,
    );
    await Deno.writeTextFile(path, filler.join("\n") + "\n");
    const lines = await readTickLog(path);
    for (const line of lines) {
      assertFalse(line.includes("�"));
      assertStringIncludes(line, "index=");
    }
    assertGreater(lines.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── isBlockedCommand ──────────────────────────────────────────────────────────

Deno.test("isBlockedCommand: returns true for hud", () => {
  assert(isBlockedCommand("hud"));
});

Deno.test("isBlockedCommand: returns true for shell", () => {
  assert(isBlockedCommand("shell"));
});

Deno.test("isBlockedCommand: returns true for tail", () => {
  assert(isBlockedCommand("tail"));
});

Deno.test("isBlockedCommand: returns true for review", () => {
  assert(isBlockedCommand("review"));
});

Deno.test("isBlockedCommand: returns false for approve", () => {
  assertFalse(isBlockedCommand("approve"));
});

Deno.test("isBlockedCommand: returns false for decline", () => {
  assertFalse(isBlockedCommand("decline"));
});

// ── parseCommand ──────────────────────────────────────────────────────────────

Deno.test("parseCommand: returns null for empty string", () => {
  assertEquals(parseCommand(""), null);
});

Deno.test("parseCommand: returns null for whitespace-only string", () => {
  assertEquals(parseCommand("  "), null);
});

Deno.test("parseCommand: returns name with empty args for single token", () => {
  assertEquals(parseCommand("approve"), { name: "approve", args: [] });
});

Deno.test("parseCommand: splits name and single arg", () => {
  assertEquals(parseCommand("approve id123"), {
    name: "approve",
    args: ["id123"],
  });
});

Deno.test("parseCommand: splits multiple args ignoring extra whitespace", () => {
  assertEquals(parseCommand("approve  id1  id2"), {
    name: "approve",
    args: ["id1", "id2"],
  });
});
