import matter from "gray-matter";
import { join } from "@std/path";
import { readTextFile } from "../src/filesystem.ts";
import { ARTIFACT_DESCRIPTORS, type ArtifactType } from "../src/state/types.ts";
import type { Migration } from "../src/migrations/types.ts";

const LEGACY_MAP: Record<string, string> = { notion: "document" };

const migration: Migration = {
  async run(ticket, stateDir) {
    const metaPath = join(stateDir, ticket.id, "meta.md");
    const raw = await readTextFile(metaPath);
    const { data } = matter(raw);

    if (Array.isArray(data.artifacts)) {
      return ticket;
    }

    const legacyArtifact = data.artifact as string | undefined;
    const rawValue = legacyArtifact
      ? (LEGACY_MAP[legacyArtifact] ?? legacyArtifact)
      : "code";
    const artifacts: ArtifactType[] = rawValue in ARTIFACT_DESCRIPTORS
      ? [rawValue as ArtifactType]
      : ["code"];

    return { ...ticket, artifacts };
  },
};

export default migration;
