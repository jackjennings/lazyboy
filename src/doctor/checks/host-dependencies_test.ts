import { assertEquals, assertStringIncludes } from "@std/assert";
import { hostDependenciesCheck } from "./host-dependencies.ts";

Deno.test("hostDependenciesCheck: all binaries found → pass", async () => {
  const result = await hostDependenciesCheck({
    runCommand: () => Promise.resolve({ code: 0, stdout: "/usr/bin/git\n" }),
  }).run();
  assertEquals(result.status, "pass");
});

Deno.test(
  "hostDependenciesCheck: one binary missing → fail with name in detail",
  async () => {
    const result = await hostDependenciesCheck({
      runCommand: (args) =>
        args.includes("git-worktreeinclude")
          ? Promise.resolve({ code: 1, stdout: "" })
          : Promise.resolve({ code: 0, stdout: "/usr/bin/x\n" }),
    }).run();
    assertEquals(result.status, "fail");
    assertStringIncludes(result.detail, "git-worktreeinclude");
  },
);

Deno.test(
  "hostDependenciesCheck: multiple missing → all listed in detail",
  async () => {
    const missing = new Set(["pi", "apfel"]);
    const result = await hostDependenciesCheck({
      runCommand: (args) =>
        missing.has(args[1])
          ? Promise.resolve({ code: 1, stdout: "" })
          : Promise.resolve({ code: 0, stdout: "/usr/bin/x\n" }),
    }).run();
    assertEquals(result.status, "fail");
    assertStringIncludes(result.detail, "pi");
    assertStringIncludes(result.detail, "apfel");
  },
);
