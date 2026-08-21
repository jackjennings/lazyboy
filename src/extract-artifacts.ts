import type { CommandRunner } from "./apfel.ts";
import { ARTIFACT_DESCRIPTORS, type ArtifactType } from "./state/types.ts";
import { ApfelLanguageModel } from "./models/apfel.ts";
import { ClaudeLanguageModel } from "./models/claude.ts";
import { FallbackLanguageModel } from "./models/fallback.ts";

const EXTRACT_ARTIFACTS_SYSTEM_PROMPT =
  'You are extracting the artifact types from an intake output written by an AI coding agent. The valid artifact types are: code (software changes via pull request), document (a Notion document, RFC, or proposal — no code changes), work (a non-code task with no pull requests). Return the artifacts array based on what the intake output specifies. If the intake output does not mention artifact types, return ["code"] as the default.';

const ARTIFACT_SCHEMA = {
  type: "object",
  properties: {
    artifacts: {
      type: "array",
      items: {
        type: "string",
        enum: Object.keys(ARTIFACT_DESCRIPTORS),
      },
      minItems: 1,
    },
  },
  required: ["artifacts"],
  additionalProperties: false,
};

export async function extractIntakeArtifacts(
  content: string,
  run: CommandRunner,
): Promise<ArtifactType[]> {
  const model = new FallbackLanguageModel([
    new ApfelLanguageModel(run),
    new ClaudeLanguageModel(run, { model: "claude-haiku-4-5" }),
  ]);
  const result = await model.generateObject<{ artifacts: ArtifactType[] }>({
    systemPrompt: EXTRACT_ARTIFACTS_SYSTEM_PROMPT,
    prompt: content,
    schema: ARTIFACT_SCHEMA,
    maxTokens: 64,
  });
  if (!result || !Array.isArray(result.artifacts)) return [];
  return result.artifacts.filter((v) => v in ARTIFACT_DESCRIPTORS);
}
