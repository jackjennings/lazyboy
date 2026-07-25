import { assertEquals, assertNotEquals } from "@std/assert";
import { buildPiArgs } from "./pi.ts";

Deno.test("buildPiArgs: includes --model with provided value", () => {
  const args = buildPiArgs(
    "prompt text",
    "claude-opus-4-5",
    "xhigh",
    "ctx",
    [],
  );
  const idx = args.indexOf("--model");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "claude-opus-4-5");
});

Deno.test("buildPiArgs: includes --thinking with provided value", () => {
  const args = buildPiArgs("prompt text", "claude-haiku-4-5", "low", "ctx", []);
  const idx = args.indexOf("--thinking");
  assertNotEquals(idx, -1);
  assertEquals(args[idx + 1], "low");
});

Deno.test("buildPiArgs: includes --thinking when value is off", () => {
  const args = buildPiArgs("prompt text", "claude-haiku-4-5", "off", "ctx", []);
  assertNotEquals(args.indexOf("--thinking"), -1);
  assertEquals(args[args.indexOf("--thinking") + 1], "off");
});

Deno.test("buildPiArgs: context files are appended after system-prompt", () => {
  const files = ["@/ticket/meta.md", "@/ticket/intake.md"];
  const args = buildPiArgs("p", "m", "off", "", files);
  assertEquals(args[args.length - 2], files[0]);
  assertEquals(args[args.length - 1], files[1]);
});
