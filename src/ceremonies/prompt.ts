import { join } from "@std/path";
import { parse } from "@std/toml";
import { compactTimestamp } from "../timestamp.ts";
import type { Ceremony } from "./types.ts";

export interface PromptCeremonyDeps {
  name: string;
  stateDir: string;
  anthropicApiKey: string;
  appendTickLog(entry: object): Promise<void>;
  fetch?: typeof globalThis.fetch;
}

export class PromptCeremony implements Ceremony {
  readonly name: string;
  readonly #deps: PromptCeremonyDeps;

  constructor(deps: PromptCeremonyDeps) {
    this.name = deps.name;
    this.#deps = deps;
  }

  async run(now: Temporal.ZonedDateTime, outputDir: string): Promise<void> {
    const fetcher = this.#deps.fetch ?? globalThis.fetch;
    const ceremonyDir = join(this.#deps.stateDir, "ceremonies", this.name);

    let model = "claude-sonnet-4-6";
    let thinkingBudget = 0;
    try {
      const raw = await Deno.readTextFile(join(ceremonyDir, "config.toml"));
      const config = parse(raw) as Record<string, unknown>;
      if (typeof config.model === "string") model = config.model;
      const t = config.thinking;
      if (typeof t === "number" && Number.isInteger(t) && t > 0) {
        thinkingBudget = t;
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

    let prompt: string;
    try {
      prompt = await Deno.readTextFile(join(ceremonyDir, "prompt.md"));
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        await this.#deps.appendTickLog({
          event: "ceremony-warning",
          ceremony: this.name,
          reason: "prompt.md missing",
        });
        return;
      }
      throw e;
    }

    const d = now.toPlainDate();
    const isoDate = `${d.year}-${String(d.month).padStart(2, "0")}-${
      String(d.day).padStart(2, "0")
    }`;

    const body: Record<string, unknown> = {
      model,
      max_tokens: thinkingBudget > 0 ? thinkingBudget + 8192 : 8192,
      system: `You are a lazyboy ceremony runner. Today is ${isoDate}.`,
      messages: [{ role: "user", content: prompt }],
    };
    if (thinkingBudget > 0) {
      body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
    }

    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.#deps.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await this.#deps.appendTickLog({
        event: "ceremony-warning",
        ceremony: this.name,
        reason: "api-error",
      });
      return;
    }

    const data = await response.json();
    const textBlock = (data?.content ?? []).find(
      (b: Record<string, unknown>) => b.type === "text",
    );
    const text: string = textBlock?.text ?? "";

    if (!text) {
      await this.#deps.appendTickLog({
        event: "ceremony-warning",
        ceremony: this.name,
        reason: "empty-response",
      });
      return;
    }

    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(
      join(outputDir, `${compactTimestamp(now)}-${this.name}.md`),
      text,
    );
  }
}
