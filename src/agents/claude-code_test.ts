import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildClaudeCodeArgs,
  ClaudeCodeAgent,
  deriveAddDirs,
} from "./claude-code.ts";

// ── deriveAddDirs ────────────────────────────────────────────────────────────

Deno.test("deriveAddDirs: returns parent dirs of context files outside cwd", () => {
  const dirs = deriveAddDirs(
    ["@/ticket/meta.md", "@/ticket/intake.md"],
    "/worktree",
  );
  assertEquals(dirs, ["/ticket"]);
});

Deno.test("deriveAddDirs: dedupes repeated parent dirs", () => {
  const dirs = deriveAddDirs(
    ["@/ticket/meta.md", "@/ticket/intake.md", "@/other/file.md"],
    "/worktree",
  );
  assertEquals(dirs, ["/other", "/ticket"]);
});

Deno.test("deriveAddDirs: excludes files already inside cwd", () => {
  const dirs = deriveAddDirs(["@/worktree/src/foo.ts"], "/worktree");
  assertEquals(dirs, []);
});

Deno.test("deriveAddDirs: excludes a file whose path equals cwd exactly (no filename)", () => {
  const dirs = deriveAddDirs(["@/worktree"], "/worktree");
  assertEquals(dirs, []);
});

Deno.test("deriveAddDirs: returns [] for empty contextFiles", () => {
  assertEquals(deriveAddDirs([], "/worktree"), []);
});

// ── buildClaudeCodeArgs ──────────────────────────────────────────────────────

Deno.test("buildClaudeCodeArgs: prompt is the first argument", () => {
  const args = buildClaudeCodeArgs(
    "do the thing",
    "claude-sonnet-4-6",
    "off",
    [],
    "/wt",
  );
  assertEquals(args[0], "do the thing");
});

Deno.test("buildClaudeCodeArgs: always includes --print, --output-format stream-json, --dangerously-skip-permissions", () => {
  const args = buildClaudeCodeArgs("p", "claude-sonnet-4-6", "off", [], "/wt");
  assertEquals(args.includes("--print"), true);
  const idx = args.indexOf("--output-format");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "stream-json");
  assertEquals(args.includes("--verbose"), true);
  assertEquals(args.includes("--dangerously-skip-permissions"), true);
});

Deno.test("buildClaudeCodeArgs: scopes settings to project,local to exclude the operator's user-level hooks/skills/MCP servers", () => {
  const args = buildClaudeCodeArgs("p", "m", "off", [], "/wt");
  const idx = args.indexOf("--setting-sources");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "project,local");
});

Deno.test("buildClaudeCodeArgs: includes --model with provided value", () => {
  const args = buildClaudeCodeArgs("p", "claude-opus-4-8", "off", [], "/wt");
  const idx = args.indexOf("--model");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "claude-opus-4-8");
});

Deno.test("buildClaudeCodeArgs: thinking 'high' maps to --effort high", () => {
  const args = buildClaudeCodeArgs("p", "m", "high", [], "/wt");
  const idx = args.indexOf("--effort");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "high");
});

Deno.test("buildClaudeCodeArgs: thinking 'xhigh' and 'max' pass through to --effort unchanged", () => {
  const xhigh = buildClaudeCodeArgs("p", "m", "xhigh", [], "/wt");
  assertEquals(xhigh[xhigh.indexOf("--effort") + 1], "xhigh");
  const max = buildClaudeCodeArgs("p", "m", "max", [], "/wt");
  assertEquals(max[max.indexOf("--effort") + 1], "max");
});

Deno.test("buildClaudeCodeArgs: thinking 'off' omits --effort", () => {
  const args = buildClaudeCodeArgs("p", "m", "off", [], "/wt");
  assertEquals(args.includes("--effort"), false);
});

Deno.test("buildClaudeCodeArgs: thinking 'minimal' omits --effort", () => {
  const args = buildClaudeCodeArgs("p", "m", "minimal", [], "/wt");
  assertEquals(args.includes("--effort"), false);
});

Deno.test("buildClaudeCodeArgs: appends a 'Read these files first' list to the prompt when contextFiles is non-empty", () => {
  const args = buildClaudeCodeArgs(
    "base prompt",
    "m",
    "off",
    ["@/ticket/meta.md", "@/ticket/intake.md"],
    "/worktree",
  );
  assertEquals(args[0].startsWith("base prompt"), true);
  assertEquals(args[0].includes("Read these files first:"), true);
  assertEquals(args[0].includes("- /ticket/meta.md"), true);
  assertEquals(args[0].includes("- /ticket/intake.md"), true);
});

Deno.test("buildClaudeCodeArgs: does not append file list when contextFiles is empty", () => {
  const args = buildClaudeCodeArgs("base prompt", "m", "off", [], "/wt");
  assertEquals(args[0], "base prompt");
});

Deno.test("buildClaudeCodeArgs: --add-dir is the last flag and takes all dirs as varargs", () => {
  const args = buildClaudeCodeArgs(
    "p",
    "m",
    "off",
    ["@/ticket/meta.md", "@/other/file.md"],
    "/worktree",
  );
  const idx = args.indexOf("--add-dir");
  assertNotEquals(idx, -1);
  assertEquals(args.slice(idx + 1), ["/other", "/ticket"]);
});

Deno.test("buildClaudeCodeArgs: omits --add-dir entirely when there are no external dirs", () => {
  const args = buildClaudeCodeArgs("p", "m", "off", [], "/wt");
  assertEquals(args.includes("--add-dir"), false);
});

// ── ClaudeCodeAgent ──────────────────────────────────────────────────────────

Deno.test("ClaudeCodeAgent: implements CodeAgent's runPhase signature", () => {
  const agent = new ClaudeCodeAgent();
  assertEquals(typeof agent.runPhase, "function");
});
