import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import { spy } from "@std/testing/mock";
import type { CommandRunner } from "../apfel.ts";
import { ApfelLanguageModel } from "./apfel.ts";

function makeRunner(
  handler: (args: string[]) => { code: number; stdout: string },
): CommandRunner {
  return spy((args: string[]) => Promise.resolve(handler(args)));
}

Deno.test("ApfelLanguageModel.generateObject: non-zero exit returns null", async () => {
  const run = makeRunner(() => ({ code: 1, stdout: "" }));
  const model = new ApfelLanguageModel(run);
  const result = await model.generateObject({
    systemPrompt: "sys",
    prompt: "body",
    schema: {},
  });
  assertEquals(result, null);
});

Deno.test("ApfelLanguageModel.generateObject: parse failure returns null", async () => {
  const run = makeRunner(() => ({ code: 0, stdout: "not json" }));
  const model = new ApfelLanguageModel(run);
  const result = await model.generateObject({
    systemPrompt: "sys",
    prompt: "body",
    schema: {},
  });
  assertEquals(result, null);
});

Deno.test("ApfelLanguageModel.generateObject: valid JSON returns typed result", async () => {
  const run = makeRunner(() => ({
    code: 0,
    stdout: '{"verdict":"KEEP"}',
  }));
  const model = new ApfelLanguageModel(run);
  const result = await model.generateObject<{ verdict: string }>({
    systemPrompt: "sys",
    prompt: "body",
    schema: {},
  });
  assertEquals(result, { verdict: "KEEP" });
});

Deno.test("ApfelLanguageModel.generateObject: -- separator present before prompt", async () => {
  let capturedArgs: string[] = [];
  const run = makeRunner((args) => {
    capturedArgs = args;
    return { code: 0, stdout: '{"ok":true}' };
  });
  const model = new ApfelLanguageModel(run);
  await model.generateObject({
    systemPrompt: "sys",
    prompt: "my prompt",
    schema: {},
  });
  assertEquals(capturedArgs[capturedArgs.length - 2], "--");
  assertEquals(capturedArgs[capturedArgs.length - 1], "my prompt");
});

Deno.test("ApfelLanguageModel.generateObject: clamps maxTokens to 64 when caller passes 5", async () => {
  let capturedArgs: string[] = [];
  const run = makeRunner((args) => {
    capturedArgs = args;
    return { code: 0, stdout: '{"ok":true}' };
  });
  const model = new ApfelLanguageModel(run);
  await model.generateObject({
    systemPrompt: "sys",
    prompt: "body",
    schema: {},
    maxTokens: 5,
  });
  const idx = capturedArgs.indexOf("--max-tokens");
  assertNotEquals(idx, -1);
  assertEquals(capturedArgs[idx + 1], "64");
});

Deno.test("ApfelLanguageModel.generateObject: schema file exists during call and is removed after", async () => {
  let capturedSchemaPath = "";
  let schemaContentDuringCall = "";
  const run = makeRunner((args) => {
    const schemaIdx = args.indexOf("--schema");
    if (schemaIdx !== -1) {
      capturedSchemaPath = args[schemaIdx + 1];
      schemaContentDuringCall = Deno.readTextFileSync(capturedSchemaPath);
    }
    return { code: 0, stdout: '{"ok":true}' };
  });
  const schema = {
    type: "object",
    properties: { verdict: { type: "string" } },
  };
  const model = new ApfelLanguageModel(run);
  await model.generateObject({ systemPrompt: "sys", prompt: "body", schema });

  assert(capturedSchemaPath !== "");
  assertEquals(JSON.parse(schemaContentDuringCall), schema);
  await assertRejects(
    () => Deno.stat(capturedSchemaPath),
    Deno.errors.NotFound,
  );
});

Deno.test("ApfelLanguageModel.generateText: non-zero exit returns null", async () => {
  const run = makeRunner(() => ({ code: 1, stdout: "" }));
  const model = new ApfelLanguageModel(run);
  const result = await model.generateText({ systemPrompt: "sys", prompt: "p" });
  assertEquals(result, null);
});

Deno.test("ApfelLanguageModel.generateText: empty stdout after trim returns null", async () => {
  const run = makeRunner(() => ({ code: 0, stdout: "   " }));
  const model = new ApfelLanguageModel(run);
  const result = await model.generateText({ systemPrompt: "sys", prompt: "p" });
  assertEquals(result, null);
});

Deno.test("ApfelLanguageModel.generateText: returns trimmed stdout on success", async () => {
  const run = makeRunner(() => ({ code: 0, stdout: "  Short Title  " }));
  const model = new ApfelLanguageModel(run);
  const result = await model.generateText({ systemPrompt: "sys", prompt: "p" });
  assertEquals(result, "Short Title");
});

Deno.test("ApfelLanguageModel.generateText: exception returns null", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.reject(new Error("not found"))
  );
  const model = new ApfelLanguageModel(run);
  const result = await model.generateText({ systemPrompt: "sys", prompt: "p" });
  assertFalse(result !== null);
});
