import { assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import {
  buildPhaseArgs,
  buildPhaseEnvOverrides,
  isPhaseAlive,
  isProcessAlive,
} from "./executor.ts";
import type { ExecutorOptions } from "./executor.ts";

function makeOpts(overrides: Partial<ExecutorOptions> = {}): ExecutorOptions {
  return {
    ticketDir: "/state/gh-1",
    stateDir: "/state",
    prompt: "do the thing",
    scopeDirs: [],
    outputFile: "intake.md",
    githubToken: "tok",
    anthropicApiKey: "key",
    worktrees: {},
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    thinking: "off",
    agent: "pi",
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

Deno.test("isProcessAlive returns true for current process", () => {
  assertEquals(isProcessAlive(Deno.pid), true);
});

Deno.test("isProcessAlive returns false for dead PID", () => {
  assertEquals(isProcessAlive(99999999), false);
});

Deno.test("buildPhaseArgs: includes --model", () => {
  const args = buildPhaseArgs(makeOpts({ model: "claude-opus-4-5" }));
  const idx = args.indexOf("--model");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "claude-opus-4-5");
});

Deno.test("buildPhaseArgs: includes --provider", () => {
  const args = buildPhaseArgs(makeOpts({ provider: "bedrock" }));
  const idx = args.indexOf("--provider");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "bedrock");
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

Deno.test("isPhaseAlive: returns false when no run.pid exists", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    assertEquals(isPhaseAlive(tempDir), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("isPhaseAlive: returns true when run.pid contains current process PID", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "run.pid"), String(Deno.pid));
    assertEquals(isPhaseAlive(tempDir), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("isPhaseAlive: returns false when run.pid contains a dead PID", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "run.pid"), "99999999");
    assertEquals(isPhaseAlive(tempDir), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildPhaseArgs: includes --agent pi by default", () => {
  const args = buildPhaseArgs(makeOpts());
  const idx = args.indexOf("--agent");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "pi");
});

Deno.test("buildPhaseArgs: includes --agent claude-code when specified", () => {
  const args = buildPhaseArgs(makeOpts({ agent: "claude-code" }));
  const idx = args.indexOf("--agent");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "claude-code");
});

Deno.test("buildPhaseArgs: pidFile option does not appear in args", () => {
  const args = buildPhaseArgs(makeOpts({ pidFile: "outlier-analysis.pid" }));
  assertEquals(args.includes("outlier-analysis.pid"), false);
  assertEquals(args.includes("--pid-file"), false);
});

Deno.test("buildPhaseArgs: includes --session-id when sessionId is provided", () => {
  const args = buildPhaseArgs(makeOpts({ sessionId: "sess-99" }));
  const idx = args.indexOf("--session-id");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "sess-99");
});

Deno.test("buildPhaseArgs: omits --session-id when sessionId is absent", () => {
  const args = buildPhaseArgs(makeOpts());
  assertEquals(args.includes("--session-id"), false);
});

Deno.test("buildPhaseArgs: includes --state-dir", () => {
  const args = buildPhaseArgs(makeOpts({ stateDir: "/my/state" }));
  const idx = args.indexOf("--state-dir");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "/my/state");
});

Deno.test("buildPhaseEnvOverrides: sets GITHUB_TOKEN and GH_TOKEN to githubToken", () => {
  const overrides = buildPhaseEnvOverrides(
    makeOpts({ githubToken: "tok_abc" }),
  );
  assertEquals(overrides["GITHUB_TOKEN"], "tok_abc");
  assertEquals(overrides["GH_TOKEN"], "tok_abc");
});

Deno.test("buildPhaseEnvOverrides: sets ANTHROPIC_API_KEY", () => {
  const overrides = buildPhaseEnvOverrides(
    makeOpts({ anthropicApiKey: "sk_test" }),
  );
  assertEquals(overrides["ANTHROPIC_API_KEY"], "sk_test");
});

Deno.test("buildPhaseEnvOverrides: GH_TOKEN matches GITHUB_TOKEN (no divergence)", () => {
  const overrides = buildPhaseEnvOverrides(
    makeOpts({ githubToken: "tok_xyz" }),
  );
  assertEquals(overrides["GH_TOKEN"], overrides["GITHUB_TOKEN"]);
});
