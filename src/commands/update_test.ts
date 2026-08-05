import { assertEquals } from "@std/assert";
import { runUpdate } from "./update.ts";

function makeRunGit(
  responses: Array<{ code: number; stdout: string; stderr: string }>,
) {
  let i = 0;
  return (_args: string[], _cwd: string) => Promise.resolve(responses[i++]);
}

Deno.test("runUpdate: dirty tree returns { code: 1, pulled: false }", async () => {
  const runGitFn = makeRunGit([
    { code: 0, stdout: "M src/foo.ts", stderr: "" },
  ]);
  assertEquals(await runUpdate("/repo", runGitFn), { code: 1, pulled: false });
});

Deno.test(
  "runUpdate: already up to date returns { code: 0, pulled: false }",
  async () => {
    const sha = "abc123";
    const runGitFn = makeRunGit([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: sha, stderr: "" },
      { code: 0, stdout: "Already up to date.", stderr: "" },
      { code: 0, stdout: sha, stderr: "" },
    ]);
    assertEquals(await runUpdate("/repo", runGitFn), {
      code: 0,
      pulled: false,
    });
  },
);

Deno.test(
  "runUpdate: new commits pulled returns { code: 0, pulled: true }",
  async () => {
    const runGitFn = makeRunGit([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "abc123", stderr: "" },
      { code: 0, stdout: "Updating abc123..def456", stderr: "" },
      { code: 0, stdout: "def456", stderr: "" },
    ]);
    assertEquals(await runUpdate("/repo", runGitFn), { code: 0, pulled: true });
  },
);

Deno.test(
  "runUpdate: pull failure returns { code: nonzero, pulled: false }",
  async () => {
    const runGitFn = makeRunGit([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "abc123", stderr: "" },
      { code: 1, stdout: "", stderr: "fatal: not a git repository" },
    ]);
    assertEquals(await runUpdate("/repo", runGitFn), {
      code: 1,
      pulled: false,
    });
  },
);
