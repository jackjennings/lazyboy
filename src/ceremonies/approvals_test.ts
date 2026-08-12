import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";
import {
  ceremonyHash,
  isCeremonyApproved,
  readApprovals,
  writeApprovals,
} from "./approvals.ts";
import { withLazyboyDir } from "../test-support.ts";

async function makeCeremonyDir(
  files: Record<string, string>,
): Promise<string> {
  const dir = await Deno.makeTempDir();
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, content);
  }
  return dir;
}

Deno.test("ceremonyHash: stable across calls", async () => {
  const dir = await makeCeremonyDir({
    "config.toml": 'time = "09:00"\n',
    "prompt.md": "do the thing\n",
  });
  try {
    assertEquals(await ceremonyHash(dir), await ceremonyHash(dir));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("ceremonyHash: changes when a file changes", async () => {
  const dir = await makeCeremonyDir({ "prompt.md": "before\n" });
  try {
    const before = await ceremonyHash(dir);
    await Deno.writeTextFile(join(dir, "prompt.md"), "after\n");
    assert(await ceremonyHash(dir) !== before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("ceremonyHash: ignores the output directory", async () => {
  const dir = await makeCeremonyDir({ "prompt.md": "x\n" });
  try {
    const before = await ceremonyHash(dir);
    await Deno.mkdir(join(dir, "output"), { recursive: true });
    await Deno.writeTextFile(join(dir, "output", "20260811T090000-x.md"), "r");
    assertEquals(await ceremonyHash(dir), before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("ceremonyHash: covers nested files outside output", async () => {
  const dir = await makeCeremonyDir({ "lib/helper.ts": "export const a = 1;" });
  try {
    const before = await ceremonyHash(dir);
    await Deno.writeTextFile(
      join(dir, "lib", "helper.ts"),
      "export const a=2;",
    );
    assert(await ceremonyHash(dir) !== before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readApprovals: missing file reads as empty", async () => {
  using _dir = withLazyboyDir();
  assertEquals(await readApprovals(), {});
});

Deno.test("writeApprovals: round-trips", async () => {
  using _dir = withLazyboyDir();
  await writeApprovals({ standup: { hash: "sha256:abc" } });
  assertEquals(await readApprovals(), { standup: { hash: "sha256:abc" } });
});

Deno.test("isCeremonyApproved: true when the hash matches", async () => {
  using _lazyboy = withLazyboyDir();
  const dir = await makeCeremonyDir({ "prompt.md": "x\n" });
  try {
    await writeApprovals({ digest: { hash: await ceremonyHash(dir) } });
    assert(await isCeremonyApproved("digest", dir));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("isCeremonyApproved: false after the directory changes", async () => {
  using _lazyboy = withLazyboyDir();
  const dir = await makeCeremonyDir({ "prompt.md": "x\n" });
  try {
    await writeApprovals({ digest: { hash: await ceremonyHash(dir) } });
    await Deno.writeTextFile(join(dir, "prompt.md"), "y\n");
    assertFalse(await isCeremonyApproved("digest", dir));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("isCeremonyApproved: false when the entry has no hash", async () => {
  using _lazyboy = withLazyboyDir();
  const dir = await makeCeremonyDir({ "prompt.md": "x\n" });
  try {
    await writeApprovals({ digest: { lastWarnedWindow: "20260811" } });
    assertFalse(await isCeremonyApproved("digest", dir));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
