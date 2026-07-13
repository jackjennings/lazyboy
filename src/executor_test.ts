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
    ...overrides,
  };
}

Deno.test("buildPhaseArgs: derives --phase from outputFile stem", () => {
  const args = buildPhaseArgs(makeOpts({ outputFile: "intake.md" }));
  const idx = args.indexOf("--phase");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "intake");
});

Deno.test("buildPhaseArgs: derives --phase diff from diff.md", () => {
  const args = buildPhaseArgs(makeOpts({ outputFile: "diff.md" }));
  const idx = args.indexOf("--phase");
  assertEquals(args[idx + 1], "diff");
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
