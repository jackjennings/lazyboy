import { assertEquals, assertStringIncludes } from "@std/assert";
import { stateRepoCheck } from "./state-repo.ts";

function makeDeps(
  overrides: Partial<Parameters<typeof stateRepoCheck>[0]> = {},
): Parameters<typeof stateRepoCheck>[0] {
  return {
    runCommand: (args) => {
      if (args.includes("--porcelain")) {
        return Promise.resolve({ code: 0, stdout: "" });
      }
      if (args.includes("log")) {
        return Promise.resolve({ code: 0, stdout: "" });
      }
      if (args.includes("signingkey")) {
        return Promise.resolve({ code: 0, stdout: "ABCDEF01\n" });
      }
      if (args[0] === "gpg") {
        return Promise.resolve({ code: 0, stdout: "sec" });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
    stateDir: "/state",
    ...overrides,
  };
}

Deno.test(
  "stateRepoCheck: clean repo, no unpushed, gpg works → pass",
  async () => {
    const result = await stateRepoCheck(makeDeps()).run();
    assertEquals(result.status, "pass");
  },
);

Deno.test("stateRepoCheck: uncommitted changes → fail", async () => {
  const result = await stateRepoCheck(makeDeps({
    runCommand: (args) => {
      if (args.includes("--porcelain")) {
        return Promise.resolve({ code: 0, stdout: " M file.ts\n" });
      }
      if (args.includes("log")) {
        return Promise.resolve({ code: 0, stdout: "" });
      }
      if (args.includes("signingkey")) {
        return Promise.resolve({ code: 0, stdout: "KEY\n" });
      }
      if (args[0] === "gpg") {
        return Promise.resolve({ code: 0, stdout: "sec" });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
  })).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "uncommitted");
});

Deno.test("stateRepoCheck: unpushed commits → warn", async () => {
  const result = await stateRepoCheck(makeDeps({
    runCommand: (args) => {
      if (args.includes("--porcelain")) {
        return Promise.resolve({ code: 0, stdout: "" });
      }
      if (args.includes("log")) {
        return Promise.resolve({ code: 0, stdout: "abc1234 message\n" });
      }
      if (args.includes("signingkey")) {
        return Promise.resolve({ code: 0, stdout: "KEY\n" });
      }
      if (args[0] === "gpg") {
        return Promise.resolve({ code: 0, stdout: "sec" });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
  })).run();
  assertEquals(result.status, "warn");
  assertStringIncludes(result.detail, "unpushed");
});

Deno.test("stateRepoCheck: GPG key not available → fail", async () => {
  const result = await stateRepoCheck(makeDeps({
    runCommand: (args) => {
      if (args.includes("--porcelain")) {
        return Promise.resolve({ code: 0, stdout: "" });
      }
      if (args.includes("log")) {
        return Promise.resolve({ code: 0, stdout: "" });
      }
      if (args.includes("signingkey")) {
        return Promise.resolve({ code: 0, stdout: "KEY\n" });
      }
      if (args[0] === "gpg") {
        return Promise.resolve({ code: 1, stdout: "" });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
  })).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "GPG");
});

Deno.test("stateRepoCheck: no signing key configured → fail", async () => {
  const result = await stateRepoCheck(makeDeps({
    runCommand: (args) => {
      if (args.includes("signingkey")) {
        return Promise.resolve({ code: 1, stdout: "" });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
  })).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "GPG");
});
