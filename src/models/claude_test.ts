import { assertEquals, assertFalse, assertNotEquals } from "@std/assert";
import { spy } from "@std/testing/mock";
import type { CommandRunner } from "../apfel.ts";
import { ClaudeLanguageModel } from "./claude.ts";

function makeRunner(
  handler: (args: string[]) => { code: number; stdout: string },
): CommandRunner {
  return spy((args: string[]) => Promise.resolve(handler(args)));
}

const MODEL = "claude-haiku-4-5";

Deno.test("ClaudeLanguageModel.generateObject: non-zero exit returns null", async () => {
  const run = makeRunner(() => ({ code: 1, stdout: "" }));
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  const result = await model.generateObject({
    systemPrompt: "sys",
    prompt: "body",
    schema: {},
  });
  assertEquals(result, null);
});

Deno.test("ClaudeLanguageModel.generateObject: parse failure returns null", async () => {
  const run = makeRunner(() => ({ code: 0, stdout: "not json" }));
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  const result = await model.generateObject({
    systemPrompt: "sys",
    prompt: "body",
    schema: {},
  });
  assertEquals(result, null);
});

Deno.test("ClaudeLanguageModel.generateObject: valid JSON returns typed result", async () => {
  const run = makeRunner(() => ({
    code: 0,
    stdout: '{"verdict":"KEEP"}',
  }));
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  const result = await model.generateObject<{ verdict: string }>({
    systemPrompt: "sys",
    prompt: "body",
    schema: {},
  });
  assertEquals(result, { verdict: "KEEP" });
});

Deno.test("ClaudeLanguageModel.generateObject: -- separator present before prompt", async () => {
  let capturedArgs: string[] = [];
  const run = makeRunner((args) => {
    capturedArgs = args;
    return { code: 0, stdout: '{"ok":true}' };
  });
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  await model.generateObject({
    systemPrompt: "sys",
    prompt: "my prompt",
    schema: {},
  });
  assertEquals(capturedArgs[capturedArgs.length - 2], "--");
  assertEquals(capturedArgs[capturedArgs.length - 1], "my prompt");
});

Deno.test("ClaudeLanguageModel.generateObject: no --bare flag in args", async () => {
  let capturedArgs: string[] = [];
  const run = makeRunner((args) => {
    capturedArgs = args;
    return { code: 0, stdout: '{"ok":true}' };
  });
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  await model.generateObject({
    systemPrompt: "sys",
    prompt: "body",
    schema: {},
  });
  assertFalse(capturedArgs.includes("--bare"));
});

Deno.test("ClaudeLanguageModel.generateObject: passes --output-format text", async () => {
  let capturedArgs: string[] = [];
  const run = makeRunner((args) => {
    capturedArgs = args;
    return { code: 0, stdout: '{"ok":true}' };
  });
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  await model.generateObject({
    systemPrompt: "sys",
    prompt: "body",
    schema: {},
  });
  const idx = capturedArgs.indexOf("--output-format");
  assertNotEquals(idx, -1);
  assertEquals(capturedArgs[idx + 1], "text");
});

Deno.test("ClaudeLanguageModel.generateText: non-zero exit returns null", async () => {
  const run = makeRunner(() => ({ code: 1, stdout: "" }));
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  const result = await model.generateText({ systemPrompt: "sys", prompt: "p" });
  assertEquals(result, null);
});

Deno.test("ClaudeLanguageModel.generateText: empty stdout after trim returns null", async () => {
  const run = makeRunner(() => ({ code: 0, stdout: "   " }));
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  const result = await model.generateText({ systemPrompt: "sys", prompt: "p" });
  assertEquals(result, null);
});

Deno.test("ClaudeLanguageModel.generateText: returns trimmed stdout on success", async () => {
  const run = makeRunner(() => ({ code: 0, stdout: "  APPROVE  " }));
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  const result = await model.generateText({ systemPrompt: "sys", prompt: "p" });
  assertEquals(result, "APPROVE");
});

Deno.test("ClaudeLanguageModel.generateText: exception returns null", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.reject(new Error("not found"))
  );
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  const result = await model.generateText({ systemPrompt: "sys", prompt: "p" });
  assertEquals(result, null);
});

Deno.test("ClaudeLanguageModel.generateText: -- separator present before prompt", async () => {
  let capturedArgs: string[] = [];
  const run = makeRunner((args) => {
    capturedArgs = args;
    return { code: 0, stdout: "ok" };
  });
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  await model.generateText({ systemPrompt: "sys", prompt: "my prompt" });
  assertEquals(capturedArgs[capturedArgs.length - 2], "--");
  assertEquals(capturedArgs[capturedArgs.length - 1], "my prompt");
});

Deno.test("ClaudeLanguageModel.generateText: passes --output-format text", async () => {
  let capturedArgs: string[] = [];
  const run = makeRunner((args) => {
    capturedArgs = args;
    return { code: 0, stdout: "ok" };
  });
  const model = new ClaudeLanguageModel(run, { model: MODEL });
  await model.generateText({ systemPrompt: "sys", prompt: "p" });
  const idx = capturedArgs.indexOf("--output-format");
  assertNotEquals(idx, -1);
  assertEquals(capturedArgs[idx + 1], "text");
});
