import { assertEquals, assertStringIncludes } from "@std/assert";
import { launchagentHealthCheck } from "./launchagent-health.ts";

const PLIST_WITH_300 = `<dict>
  <key>StartInterval</key>
  <integer>300</integer>
</dict>`;

const BTM_WITH_ALLOWED = `BackgroundTask {
    Identifier: com.jackjennings.urras
    Disposition: [enabled, allowed, notified] (0xb)
}`;

const BTM_WITHOUT_ALLOWED = `BackgroundTask {
    Identifier: com.jackjennings.urras
    Disposition: [enabled, denied, notified] (0x9)
}`;

const PRINT_DISABLED_CLEAN = `{\n\t"com.jackjennings.urras" => false\n}`;
const PRINT_DISABLED_OFF = `{\n\t"com.jackjennings.urras" => true\n}`;

function makeDeps(
  overrides: Partial<Parameters<typeof launchagentHealthCheck>[0]> = {},
): Parameters<typeof launchagentHealthCheck>[0] {
  return {
    runCommand: (args) => {
      if (args[1] === "print") {
        return Promise.resolve({ code: 0, stdout: "" });
      }
      if (args[0] === "sfltool") {
        return Promise.resolve({ code: 0, stdout: BTM_WITH_ALLOWED });
      }
      if (args[1] === "print-disabled") {
        return Promise.resolve({ code: 0, stdout: PRINT_DISABLED_CLEAN });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
    readTextFile: () => Promise.resolve(PLIST_WITH_300),
    uid: 501,
    plistPath: "/Library/LaunchAgents/com.jackjennings.urras.plist",
    ...overrides,
  };
}

Deno.test("launchagentHealthCheck: all sub-checks pass → pass", async () => {
  const result = await launchagentHealthCheck(makeDeps()).run();
  assertEquals(result.status, "pass");
});

Deno.test("launchagentHealthCheck: launchctl print non-zero → fail", async () => {
  const result = await launchagentHealthCheck(makeDeps({
    runCommand: (args) => {
      if (args[1] === "print") {
        return Promise.resolve({ code: 1, stdout: "" });
      }
      if (args[0] === "sfltool") {
        return Promise.resolve({ code: 0, stdout: BTM_WITH_ALLOWED });
      }
      if (args[1] === "print-disabled") {
        return Promise.resolve({ code: 0, stdout: PRINT_DISABLED_CLEAN });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
  })).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "not loaded");
});

Deno.test(
  "launchagentHealthCheck: BTM disposition missing allowed → fail",
  async () => {
    const result = await launchagentHealthCheck(makeDeps({
      runCommand: (args) => {
        if (args[1] === "print") {
          return Promise.resolve({ code: 0, stdout: "" });
        }
        if (args[0] === "sfltool") {
          return Promise.resolve({ code: 0, stdout: BTM_WITHOUT_ALLOWED });
        }
        if (args[1] === "print-disabled") {
          return Promise.resolve({ code: 0, stdout: PRINT_DISABLED_CLEAN });
        }
        return Promise.resolve({ code: 0, stdout: "" });
      },
    })).run();
    assertEquals(result.status, "fail");
    assertStringIncludes(result.detail, "allowed");
  },
);

Deno.test("launchagentHealthCheck: sfltool timeout → warn, not fail", async () => {
  const result = await launchagentHealthCheck(makeDeps({
    runCommand: (args) => {
      if (args[1] === "print") {
        return Promise.resolve({ code: 0, stdout: "" });
      }
      if (args[0] === "sfltool") {
        return Promise.resolve({ code: 1, stdout: "" });
      }
      if (args[1] === "print-disabled") {
        return Promise.resolve({ code: 0, stdout: PRINT_DISABLED_CLEAN });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
  })).run();
  assertEquals(result.status, "warn");
});

Deno.test("launchagentHealthCheck: StartInterval != 300 → fail", async () => {
  const result = await launchagentHealthCheck(makeDeps({
    readTextFile: () =>
      Promise.resolve(`<key>StartInterval</key><integer>60</integer>`),
  })).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "StartInterval");
});

Deno.test("launchagentHealthCheck: explicitly disabled → fail", async () => {
  const result = await launchagentHealthCheck(makeDeps({
    runCommand: (args) => {
      if (args[1] === "print") {
        return Promise.resolve({ code: 0, stdout: "" });
      }
      if (args[0] === "sfltool") {
        return Promise.resolve({ code: 0, stdout: BTM_WITH_ALLOWED });
      }
      if (args[1] === "print-disabled") {
        return Promise.resolve({ code: 0, stdout: PRINT_DISABLED_OFF });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
  })).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "disabled");
});
