import { assertEquals, assertStringIncludes } from "@std/assert";
import { launchdSpawnSuppressionCheck } from "./launchd-spawn-suppression.ts";

const NOW = 1_000_000;
const PLIST_300 = `<key>StartInterval</key><integer>300</integer>`;

function ts(secondsAgo: number): string {
  return new Date((NOW - secondsAgo) * 1000).toISOString();
}

function makeDeps(
  overrides: Partial<Parameters<typeof launchdSpawnSuppressionCheck>[0]> = {},
): Parameters<typeof launchdSpawnSuppressionCheck>[0] {
  return {
    readTextFile: (path) => {
      if (path.endsWith("tick.ndjson")) {
        return Promise.resolve(
          JSON.stringify({ ts: ts(100), event: "tick-start" }),
        );
      }
      return Promise.resolve(PLIST_300);
    },
    urrasDir: "/urras",
    runCommand: () =>
      Promise.resolve({ code: 0, stdout: "runs = 5\nlast exit code = 0\n" }),
    uid: 501,
    plistPath: "/Library/LaunchAgents/com.jackjennings.urras.plist",
    now: () => NOW,
    ...overrides,
  };
}

Deno.test("launchdSpawnSuppressionCheck: recent tick-start → pass", async () => {
  const result = await launchdSpawnSuppressionCheck(makeDeps()).run();
  assertEquals(result.status, "pass");
});

Deno.test(
  "launchdSpawnSuppressionCheck: tick.ndjson absent → pass (no signal)",
  async () => {
    const result = await launchdSpawnSuppressionCheck(makeDeps({
      readTextFile: (path) => {
        if (path.endsWith("tick.ndjson")) {
          return Promise.reject(new Deno.errors.NotFound());
        }
        return Promise.resolve(PLIST_300);
      },
    })).run();
    assertEquals(result.status, "pass");
  },
);

Deno.test(
  "launchdSpawnSuppressionCheck: >2 intervals elapsed and runs>0 → fail",
  async () => {
    const result = await launchdSpawnSuppressionCheck(makeDeps({
      readTextFile: (path) => {
        if (path.endsWith("tick.ndjson")) {
          return Promise.resolve(
            JSON.stringify({ ts: ts(800), event: "tick-start" }),
          );
        }
        return Promise.resolve(PLIST_300);
      },
    })).run();
    assertEquals(result.status, "fail");
    assertStringIncludes(result.detail, "spawn suppression");
  },
);

Deno.test(
  "launchdSpawnSuppressionCheck: >2 intervals but runs=0 → pass (never ran)",
  async () => {
    const result = await launchdSpawnSuppressionCheck(makeDeps({
      readTextFile: (path) => {
        if (path.endsWith("tick.ndjson")) {
          return Promise.resolve(
            JSON.stringify({ ts: ts(800), event: "tick-start" }),
          );
        }
        return Promise.resolve(PLIST_300);
      },
      runCommand: () =>
        Promise.resolve({ code: 0, stdout: "runs = 0\nlast exit code = 0\n" }),
    })).run();
    assertEquals(result.status, "pass");
  },
);

Deno.test(
  "launchdSpawnSuppressionCheck: log show corroborates → detail includes confirmation",
  async () => {
    const result = await launchdSpawnSuppressionCheck(makeDeps({
      readTextFile: (path) => {
        if (path.endsWith("tick.ndjson")) {
          return Promise.resolve(
            JSON.stringify({ ts: ts(800), event: "tick-start" }),
          );
        }
        return Promise.resolve(PLIST_300);
      },
      runCommand: (args) => {
        if (args[0] === "log") {
          return Promise.resolve({
            code: 0,
            stdout: "pending spawn, domain in on-demand-only mode\n",
          });
        }
        return Promise.resolve({
          code: 0,
          stdout: "runs = 5\nlast exit code = 0\n",
        });
      },
    })).run();
    assertEquals(result.status, "fail");
    assertStringIncludes(result.detail, "on-demand-only");
  },
);
