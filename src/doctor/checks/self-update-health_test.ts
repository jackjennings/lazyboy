import { assertEquals, assertStringIncludes } from "@std/assert";
import { selfUpdateHealthCheck } from "./self-update-health.ts";

const NOW = 1_000_000;

function ts(secondsAgo: number): string {
  return new Date((NOW - secondsAgo) * 1000).toISOString();
}

function makeDeps(
  overrides: Partial<Parameters<typeof selfUpdateHealthCheck>[0]> = {},
): Parameters<typeof selfUpdateHealthCheck>[0] {
  return {
    runCommand: () => Promise.resolve({ code: 0, stdout: "0\n" }),
    repoPath: "/repo",
    readTextFile: () => Promise.resolve(""),
    urrasDir: "/urras",
    now: () => NOW,
    ...overrides,
  };
}

Deno.test(
  "selfUpdateHealthCheck: up to date, no update events → pass",
  async () => {
    const result = await selfUpdateHealthCheck(makeDeps()).run();
    assertEquals(result.status, "pass");
  },
);

Deno.test("selfUpdateHealthCheck: ahead > 0 → warn", async () => {
  const result = await selfUpdateHealthCheck(makeDeps({
    runCommand: (args) =>
      args.includes("@{u}..HEAD")
        ? Promise.resolve({ code: 0, stdout: "3\n" })
        : Promise.resolve({ code: 0, stdout: "0\n" }),
  })).run();
  assertEquals(result.status, "warn");
  assertStringIncludes(result.detail, "ahead");
});

Deno.test("selfUpdateHealthCheck: behind > 0 → warn", async () => {
  const result = await selfUpdateHealthCheck(makeDeps({
    runCommand: (args) =>
      args.includes("HEAD..@{u}")
        ? Promise.resolve({ code: 0, stdout: "2\n" })
        : Promise.resolve({ code: 0, stdout: "0\n" }),
  })).run();
  assertEquals(result.status, "warn");
  assertStringIncludes(result.detail, "behind");
});

Deno.test("selfUpdateHealthCheck: update-failed in last 7 days → fail", async () => {
  const log = JSON.stringify({ ts: ts(3600), event: "update-failed" });
  const result = await selfUpdateHealthCheck(makeDeps({
    readTextFile: () => Promise.resolve(log),
  })).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "update-failed");
});

Deno.test("selfUpdateHealthCheck: ≥3 update-skipped in 7 days → warn", async () => {
  const log = [
    { ts: ts(100), event: "update-skipped" },
    { ts: ts(200), event: "update-skipped" },
    { ts: ts(300), event: "update-skipped" },
  ].map((e) => JSON.stringify(e)).join("\n");
  const result = await selfUpdateHealthCheck(makeDeps({
    readTextFile: () => Promise.resolve(log),
  })).run();
  assertEquals(result.status, "warn");
  assertStringIncludes(result.detail, "update-skipped");
});

Deno.test(
  "selfUpdateHealthCheck: git command fails (no upstream) → warn",
  async () => {
    const result = await selfUpdateHealthCheck(makeDeps({
      runCommand: () => Promise.resolve({ code: 128, stdout: "" }),
    })).run();
    assertEquals(result.status, "warn");
    assertStringIncludes(result.detail, "upstream");
  },
);
