import matter from "gray-matter";
import { join } from "@std/path";
import type { Migration } from "../src/migrations/types.ts";
import { readTextFile } from "../src/filesystem.ts";
import type { ArtifactType } from "../src/state/types.ts";

const migration: Migration = {
  async run(ticket, stateDir) {
    const raw = await readTextFile(join(stateDir, ticket.id, "meta.md"));
    const { data } = matter(raw);
    if (data.artifact !== "notion" && !data.notionPages) {
      return ticket;
    }
    return {
      ...ticket,
      artifact: "document" as ArtifactType,
      documents: (data.documents ?? data.notionPages) as
        | { url: string; title: string }[]
        | undefined,
    };
  },
};

export default migration;
