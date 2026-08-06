import { assertEquals } from "@std/assert";

const script = new URL("../scripts/commit-lint.sh", import.meta.url).pathname;

async function lint(subject: string): Promise<number> {
  const tmp = await Deno.makeTempFile();
  await Deno.writeTextFile(tmp, subject);
  const { code } = await new Deno.Command("bash", {
    args: [script, tmp],
    stderr: "null",
  }).output();
  await Deno.remove(tmp);
  return code;
}

Deno.test("commit-lint: accepts valid conventional commit", async () => {
  assertEquals(await lint("feat(tick): add scroll indicator"), 0);
});

Deno.test("commit-lint: rejects plain prose commit", async () => {
  assertEquals(await lint("Add scroll indicator"), 1);
});

Deno.test("commit-lint: accepts Revert-prefixed subject", async () => {
  assertEquals(await lint('Revert "feat(tick): add scroll indicator"'), 0);
});

Deno.test("commit-lint: skips comment lines when finding subject", async () => {
  const tmp = await Deno.makeTempFile();
  await Deno.writeTextFile(tmp, "# comment\nfeat(tick): add scroll indicator");
  const { code } = await new Deno.Command("bash", {
    args: [script, tmp],
    stderr: "null",
  }).output();
  await Deno.remove(tmp);
  assertEquals(code, 0);
});
