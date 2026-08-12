export interface LanguageModelRequest {
  systemPrompt: string;
  prompt: string;
  maxTokens?: number;
}

export interface LanguageModel {
  readonly name: string;
  generateText(request: LanguageModelRequest): Promise<string | null>;
  generateObject<T>(
    request: LanguageModelRequest & { schema: object },
  ): Promise<T | null>;
}
