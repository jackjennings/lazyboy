import { assertEquals } from "@std/assert";
import type { LanguageModel, LanguageModelRequest } from "./types.ts";
import { FallbackLanguageModel } from "./fallback.ts";

function makeModel(result: object | null): {
  model: LanguageModel;
  callCount: () => number;
} {
  let count = 0;
  const model: LanguageModel = {
    name: "mock",
    generateText(_req: LanguageModelRequest) {
      return Promise.resolve(null);
    },
    generateObject<T>(
      _req: LanguageModelRequest & { schema: object },
    ): Promise<T | null> {
      count++;
      return Promise.resolve(result as T | null);
    },
  };
  return { model, callCount: () => count };
}

Deno.test("FallbackLanguageModel.generateObject: first model null, second is called", async () => {
  const first = makeModel(null);
  const second = makeModel({ verdict: "KEEP" });
  const fallback = new FallbackLanguageModel([first.model, second.model]);

  const result = await fallback.generateObject({
    systemPrompt: "sys",
    prompt: "p",
    schema: {},
  });

  assertEquals(first.callCount(), 1);
  assertEquals(second.callCount(), 1);
  assertEquals(result, { verdict: "KEEP" });
});

Deno.test("FallbackLanguageModel.generateObject: first model non-null, second not called", async () => {
  const first = makeModel({ verdict: "SKIP" });
  const second = makeModel({ verdict: "KEEP" });
  const fallback = new FallbackLanguageModel([first.model, second.model]);

  const result = await fallback.generateObject({
    systemPrompt: "sys",
    prompt: "p",
    schema: {},
  });

  assertEquals(first.callCount(), 1);
  assertEquals(second.callCount(), 0);
  assertEquals(result, { verdict: "SKIP" });
});

Deno.test("FallbackLanguageModel.generateObject: all models null returns null", async () => {
  const first = makeModel(null);
  const second = makeModel(null);
  const fallback = new FallbackLanguageModel([first.model, second.model]);

  const result = await fallback.generateObject({
    systemPrompt: "sys",
    prompt: "p",
    schema: {},
  });

  assertEquals(first.callCount(), 1);
  assertEquals(second.callCount(), 1);
  assertEquals(result, null);
});
