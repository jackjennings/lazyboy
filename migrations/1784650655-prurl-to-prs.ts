import matter from "gray-matter";
import { join } from "@std/path";
import type { Migration } from "../src/migrations/types.ts";
import type { PrEntry } from "../src/state/types.ts";
import { readTextFile } from "../src/filesystem.ts";

const migration: Migration = {
  async run(ticket, stateDir) {
    if (ticket.prs !== undefined) return ticket;

    const metaPath = join(stateDir, ticket.id, "meta.md");
    let raw: string;
    try {
      raw = await readTextFile(metaPath);
    } catch {
      return ticket;
    }

    const { data } = matter(raw);
    const prUrl = data.prUrl as string | undefined;
    if (!prUrl) return ticket;

    const prs: PrEntry[] = [{
      url: prUrl,
      title: "",
      dependsOn: [],
      merged: false,
      worktreeKey: Object.keys(ticket.worktrees)[0],
    }];

    return { ...ticket, prs };
  },
};

export default migration;
