import { assertEquals, assertExists, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { mkdir, readTextFile, writeTextFile } from "../src/filesystem.ts";
import migration from "./1787097600-seed-repo-identities.ts";

async function makeTicketDir(
  stateDir: string,
  id: string,
  created: string,
): Promise<void> {
  const dir = join(stateDir, id);
  await mkdir(dir, { recursive: true });
  await writeTextFile(
    join(dir, "meta.md"),
    `---\nid: ${id}\ncreated: '${created}'\n---\n`,
  );
}

Deno.test(
  "seed-repo-identities: seeds repos.json from github ticket directories",
  async () => {
    const stateDir = await Deno.makeTempDir();
    await makeTicketDir(stateDir, "github/org/repo/1", "2026-01-01T00:00:00Z");
    await makeTicketDir(stateDir, "github/org/repo/2", "2025-06-01T00:00:00Z");
    await makeTicketDir(
      stateDir,
      "github/org/other/3",
      "2026-03-01T00:00:00Z",
    );
    await makeTicketDir(stateDir, "jira/PROJ-1", "2026-01-01T00:00:00Z");

    await migration.run(stateDir);

    const raw = await readTextFile(join(stateDir, "repos.json"));
    const table = JSON.parse(raw);

    assertExists(table["org/repo"]);
    assertEquals(table["org/repo"].repoId, null);
    assertEquals(table["org/repo"].currentSlug, "org/repo");
    assertEquals(table["org/repo"].aliases, ["org/repo"]);
    assertEquals(table["org/repo"].seenBefore, "2025-06-01T00:00:00Z");
    assertEquals(table["org/repo"].blockedBy, null);

    assertExists(table["org/other"]);
    assertEquals(table["org/other"].seenBefore, "2026-03-01T00:00:00Z");

    assertFalse("jira/PROJ-1" in table);
    assertEquals(Object.keys(table).length, 2);
    await Deno.remove(stateDir, { recursive: true });
  },
);

Deno.test("seed-repo-identities: does not modify any ticket file", async () => {
  const stateDir = await Deno.makeTempDir();
  await makeTicketDir(stateDir, "github/org/repo/1", "2026-01-01T00:00:00Z");
  const before = await readTextFile(
    join(stateDir, "github/org/repo/1/meta.md"),
  );
  await migration.run(stateDir);
  const after = await readTextFile(
    join(stateDir, "github/org/repo/1/meta.md"),
  );
  assertEquals(before, after);
  await Deno.remove(stateDir, { recursive: true });
});

Deno.test(
  "seed-repo-identities: skips write when no github tickets exist",
  async () => {
    const stateDir = await Deno.makeTempDir();
    await migration.run(stateDir);
    let found = false;
    try {
      await readTextFile(join(stateDir, "repos.json"));
      found = true;
    } catch {
      // expected
    }
    assertFalse(found);
    await Deno.remove(stateDir, { recursive: true });
  },
);
