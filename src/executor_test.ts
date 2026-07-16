import { assertEquals, assertNotEquals } from "@std/assert";
import { buildPhaseArgs, isPidAlive } from "./executor.ts";
import type { ExecutorOptions } from "./executor.ts";

function makeOpts(overrides: Partial<ExecutorOptions> = {}): ExecutorOptions {
  return {
    ticketDir: "/state/gh-1",
    prompt: "do the thing",
    scopeDirs: [],
    outputFile: "intake.md",
    githubToken: "tok",
    anthropicApiKey: "key",
    worktrees: {},
    model: "claude-sonnet-4-6",
    thinking: "off",
    ...overrides,
  };
}

Deno.test("buildPhaseArgs: derives --phase from outputFile stem", () => {
  const args = buildPhaseArgs(makeOpts({ outputFile: "intake.md" }));
  const idx = args.indexOf("--phase");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "intake");
});

Deno.test("buildPhaseArgs: includes --ticket-dir", () => {
  const args = buildPhaseArgs(makeOpts({ ticketDir: "/state/gh-42" }));
  const idx = args.indexOf("--ticket-dir");
  assertEquals(args[idx + 1], "/state/gh-42");
});

Deno.test("buildPhaseArgs: includes --output-file", () => {
  const args = buildPhaseArgs(makeOpts({ outputFile: "spec.md" }));
  const idx = args.indexOf("--output-file");
  assertEquals(args[idx + 1], "spec.md");
});

Deno.test("buildPhaseArgs: does not include bash wrapper flags", () => {
  const args = buildPhaseArgs(makeOpts());
  assertEquals(args.includes("-c"), false);
  assertEquals(args.includes("bash"), false);
});

Deno.test("buildPhaseArgs: first two args are run --allow-all", () => {
  const args = buildPhaseArgs(makeOpts());
  assertEquals(args[0], "run");
  assertEquals(args[1], "--allow-all");
});

Deno.test("isPidAlive returns true for current process", () => {
  assertEquals(isPidAlive(Deno.pid), true);
});

Deno.test("isPidAlive returns false for dead PID", () => {
  assertEquals(isPidAlive(99999999), false);
});

Deno.test("buildPhaseArgs: includes --model", () => {
  const args = buildPhaseArgs(makeOpts({ model: "claude-opus-4-5" }));
  const idx = args.indexOf("--model");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "claude-opus-4-5");
});

Deno.test("buildPhaseArgs: includes --thinking", () => {
  const args = buildPhaseArgs(makeOpts({ thinking: "high" }));
  const idx = args.indexOf("--thinking");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "high");
});

Deno.test("buildPhaseArgs: includes --thinking off", () => {
  const args = buildPhaseArgs(makeOpts({ thinking: "off" }));
  assertEquals(args[args.indexOf("--thinking") + 1], "off");
});

Deno.test("buildPhaseArgs: includes --context-files when contextFiles is provided", () => {
  const args = buildPhaseArgs(
    makeOpts({ contextFiles: ["@/ticket/meta.md", "@/ticket/context.md"] }),
  );
  const idx = args.indexOf("--context-files");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "@/ticket/meta.md,@/ticket/context.md");
});

Deno.test("buildPhaseArgs: omits --context-files when contextFiles is not provided", () => {
  const args = buildPhaseArgs(makeOpts());
  assertEquals(args.includes("--context-files"), false);
});
