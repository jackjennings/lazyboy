import { assertArrayIncludes, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  aliasesFor,
  canonicalSlugFor,
  CorruptRepoIdentitiesError,
  currentSlugFor,
  makeTableIO,
  type RepoIdentityTable,
} from "./repo-identity.ts";

Deno.test("readTable: missing file returns empty table", async () => {
  const dir = await Deno.makeTempDir();
  const { readTable } = makeTableIO(join(dir, "repos.json"));
  assertEquals(await readTable(), {});
  await Deno.remove(dir, { recursive: true });
});

Deno.test("readTable: non-JSON file throws CorruptRepoIdentitiesError", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "repos.json"), "not json");
  const { readTable } = makeTableIO(join(dir, "repos.json"));
  await assertRejects(() => readTable(), CorruptRepoIdentitiesError);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("readTable: non-object JSON throws CorruptRepoIdentitiesError", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "repos.json"), '"a string"');
  const { readTable } = makeTableIO(join(dir, "repos.json"));
  await assertRejects(() => readTable(), CorruptRepoIdentitiesError);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTable then readTable round-trips", async () => {
  const dir = await Deno.makeTempDir();
  const { readTable, writeTable } = makeTableIO(join(dir, "repos.json"));
  const table: RepoIdentityTable = {
    "foo/bar": {
      repoId: 1,
      currentSlug: "foo/baz",
      aliases: ["foo/bar", "foo/baz"],
      blockedBy: null,
    },
  };
  await writeTable(table);
  assertEquals(await readTable(), table);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("aliasesFor: unknown slug returns singleton", () => {
  assertEquals(aliasesFor({}, "foo/bar"), ["foo/bar"]);
});

Deno.test("aliasesFor: alias resolves to canonical entry's full alias set", () => {
  const table: RepoIdentityTable = {
    "foo/bar": {
      repoId: 1,
      currentSlug: "foo/baz",
      aliases: ["foo/bar", "foo/baz"],
      blockedBy: null,
    },
  };
  assertArrayIncludes(aliasesFor(table, "foo/baz"), ["foo/bar", "foo/baz"]);
});

Deno.test("canonicalSlugFor: alias resolves to canonical key", () => {
  const table: RepoIdentityTable = {
    "foo/bar": {
      repoId: 1,
      currentSlug: "foo/baz",
      aliases: ["foo/bar", "foo/baz"],
      blockedBy: null,
    },
  };
  assertEquals(canonicalSlugFor(table, "foo/baz"), "foo/bar");
});

Deno.test("canonicalSlugFor: unknown slug returns itself", () => {
  assertEquals(canonicalSlugFor({}, "foo/missing"), "foo/missing");
});

Deno.test("currentSlugFor: known entry returns currentSlug", () => {
  const table: RepoIdentityTable = {
    "foo/bar": {
      repoId: 1,
      currentSlug: "foo/baz",
      aliases: ["foo/bar", "foo/baz"],
      blockedBy: null,
    },
  };
  assertEquals(currentSlugFor(table, "foo/bar"), "foo/baz");
});

Deno.test("currentSlugFor: unknown slug returns itself", () => {
  assertEquals(currentSlugFor({}, "foo/bar"), "foo/bar");
});
