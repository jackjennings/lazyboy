import { assertEquals, assertStringIncludes } from "@std/assert";
import { staleHudProcessCheck } from "./stale-hud-process.ts";

function makeDeps(
  overrides: Partial<Parameters<typeof staleHudProcessCheck>[0]> = {},
): Parameters<typeof staleHudProcessCheck>[0] {
  return {
    runCommand: () => Promise.resolve({ code: 1, stdout: "" }),
    repoPath: "/repo",
    ...overrides,
  };
}

Deno.test("staleHudProcessCheck: no hud processes → pass", async () => {
  const result = await staleHudProcessCheck(makeDeps({
    runCommand: () => Promise.resolve({ code: 1, stdout: "" }),
  })).run();
  assertEquals(result.status, "pass");
});

Deno.test(
  "staleHudProcessCheck: hud process newer than HEAD commit → pass",
  async () => {
    const result = await staleHudProcessCheck(makeDeps({
      runCommand: (args) => {
        if (args[0] === "pgrep") {
          return Promise.resolve({ code: 0, stdout: "1234\n" });
        }
        if (args.includes("-o")) {
          return Promise.resolve({
            code: 0,
            stdout: "Fri Aug 20 22:00:00 2100\n",
          });
        }
        if (args.includes("--format=%ct")) {
          return Promise.resolve({ code: 0, stdout: "1000\n" });
        }
        return Promise.resolve({ code: 0, stdout: "" });
      },
    })).run();
    assertEquals(result.status, "pass");
  },
);

Deno.test(
  "staleHudProcessCheck: hud process older than HEAD commit → warn with PID",
  async () => {
    const result = await staleHudProcessCheck(makeDeps({
      runCommand: (args) => {
        if (args[0] === "pgrep") {
          return Promise.resolve({ code: 0, stdout: "1234\n" });
        }
        if (args.includes("-o")) {
          return Promise.resolve({
            code: 0,
            stdout: "Thu Jan  1 00:00:01 1970\n",
          });
        }
        if (args.includes("--format=%ct")) {
          return Promise.resolve({ code: 0, stdout: "9999999999\n" });
        }
        return Promise.resolve({ code: 0, stdout: "" });
      },
    })).run();
    assertEquals(result.status, "warn");
    assertStringIncludes(result.detail, "1234");
  },
);
