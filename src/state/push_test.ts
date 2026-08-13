import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { pushStateIfOriginExists } from "./push.ts";

const ok = { code: 0, stdout: "", stderr: "" };
const fail = { code: 1, stdout: "", stderr: "error" };

Deno.test("pushStateIfOriginExists: skips push when no origin remote", async () => {
  const runGit = spy((_args: string[], _cwd: string) => Promise.resolve(fail));
  const log = spy((_entry: object) => Promise.resolve());
  await pushStateIfOriginExists("/state", runGit, log);
  assertSpyCalls(runGit, 1);
  assertSpyCalls(log, 0);
});

Deno.test(
  "pushStateIfOriginExists: pushes when origin exists and logs nothing on success",
  async () => {
    const runGit = spy((_args: string[], _cwd: string) => Promise.resolve(ok));
    const log = spy((_entry: object) => Promise.resolve());
    await pushStateIfOriginExists("/state", runGit, log);
    assertSpyCalls(runGit, 2);
    assertSpyCalls(log, 0);
  },
);

Deno.test("pushStateIfOriginExists: logs error event when push fails", async () => {
  const loggedEntries: object[] = [];
  const runGit = spy((args: string[], _cwd: string) =>
    Promise.resolve(args[0] === "push" ? fail : ok)
  );
  const log = spy((entry: object) => {
    loggedEntries.push(entry);
    return Promise.resolve();
  });
  await pushStateIfOriginExists("/state", runGit, log);
  assertSpyCalls(log, 1);
  assertEquals(loggedEntries[0], { event: "error", context: "pushState" });
});

Deno.test(
  "pushStateIfOriginExists: uses stateDir as cwd for both git calls",
  async () => {
    const cwds: string[] = [];
    const runGit = spy((_args: string[], cwd: string) => {
      cwds.push(cwd);
      return Promise.resolve(ok);
    });
    const log = spy((_entry: object) => Promise.resolve());
    await pushStateIfOriginExists("/my/stateDir", runGit, log);
    assertEquals(cwds, ["/my/stateDir", "/my/stateDir"]);
  },
);

Deno.test(
  "pushStateIfOriginExists: passes correct args to check and push commands",
  async () => {
    const allArgs: string[][] = [];
    const runGit = spy((args: string[], _cwd: string) => {
      allArgs.push(args);
      return Promise.resolve(ok);
    });
    const log = spy((_entry: object) => Promise.resolve());
    await pushStateIfOriginExists("/state", runGit, log);
    assertEquals(allArgs[0], ["remote", "get-url", "origin"]);
    assertEquals(allArgs[1], ["push", "origin", "main"]);
  },
);
