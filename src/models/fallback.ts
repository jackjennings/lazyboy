import type { LanguageModel, LanguageModelRequest } from "./types.ts";

export class FallbackLanguageModel implements LanguageModel {
  readonly name = "fallback";

  constructor(private readonly models: LanguageModel[]) {}

  async generateObject<T>(
    request: LanguageModelRequest & { schema: object },
  ): Promise<T | null> {
    for (const model of this.models) {
      const result = await model.generateObject<T>(request);
      if (result !== null) return result;
    }
    return null;
  }

  async generateText(request: LanguageModelRequest): Promise<string | null> {
    for (const model of this.models) {
      const result = await model.generateText(request);
      if (result !== null) return result;
    }
    return null;
  }
}
