import { assertEquals, assertNotEquals } from "@std/assert";
import { buildPiArgs } from "./pi.ts";

Deno.test("buildPiArgs: includes --model with provided value", () => {
  const args = buildPiArgs({
    prompt: "prompt text",
    model: "claude-opus-4-5",
    thinking: "xhigh",
    pathContext: "ctx",
    contextFiles: [],
  });
  const idx = args.indexOf("--model");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "claude-opus-4-5");
});

Deno.test("buildPiArgs: includes --thinking with provided value", () => {
  const args = buildPiArgs({
    prompt: "prompt text",
    model: "claude-haiku-4-5",
    thinking: "low",
    pathContext: "ctx",
    contextFiles: [],
  });
  const idx = args.indexOf("--thinking");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "low");
});

Deno.test("buildPiArgs: includes --thinking when value is off", () => {
  const args = buildPiArgs({
    prompt: "prompt text",
    model: "claude-haiku-4-5",
    thinking: "off",
    pathContext: "ctx",
    contextFiles: [],
  });
  assertNotEquals(args.indexOf("--thinking"), -1);
  assertEquals(args[args.indexOf("--thinking") + 1], "off");
});

Deno.test("buildPiArgs: context files are appended after system-prompt", () => {
  const files = ["@/ticket/meta.md", "@/ticket/intake.md"];
  const args = buildPiArgs({
    prompt: "p",
    model: "m",
    thinking: "off",
    pathContext: "",
    contextFiles: files,
  });
  assertEquals(args[args.length - 2], files[0]);
  assertEquals(args[args.length - 1], files[1]);
});

Deno.test("buildPiArgs: includes --session-id when sessionId is provided", () => {
  const args = buildPiArgs({
    prompt: "p",
    model: "claude-sonnet-4-6",
    thinking: "off",
    pathContext: "",
    contextFiles: [],
    provider: "anthropic",
    sessionId: "sess-abc",
  });
  const idx = args.indexOf("--session-id");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "sess-abc");
});

Deno.test("buildPiArgs: omits --session-id when sessionId is absent", () => {
  const args = buildPiArgs({
    prompt: "p",
    model: "claude-sonnet-4-6",
    thinking: "off",
    pathContext: "",
    contextFiles: [],
  });
  assertEquals(args.includes("--session-id"), false);
});
