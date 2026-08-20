import { assertEquals, assertStringIncludes } from "@std/assert";
import { powerManagementCheck } from "./power-management.ts";

const NO_ASSERTION =
  `Assertion status system-wide:\n   PreventUserIdleSystemSleep         0\n`;
const WITH_ASSERTION =
  `Assertion status system-wide:\n   PreventUserIdleSystemSleep         1\n`;

function makeCustom(batterySleep: number, acSleep: number): string {
  return `Battery Power:\n sleep\t\t\t${batterySleep}\n\nAC Power:\n sleep\t\t\t${acSleep}\n`;
}

const POWER_SOURCE_BATTERY = `Now drawing from 'Battery Power'\n`;
const _POWER_SOURCE_AC = `Now drawing from 'AC Power'\n`;

function makeDeps(
  batterySleep: number,
  acSleep: number,
  assertionsOutput = NO_ASSERTION,
  powerSourceOutput = POWER_SOURCE_BATTERY,
): Parameters<typeof powerManagementCheck>[0] {
  return {
    runCommand: (args) => {
      if (args.includes("assertions")) {
        return Promise.resolve({ code: 0, stdout: assertionsOutput });
      }
      if (args.includes("custom")) {
        return Promise.resolve({
          code: 0,
          stdout: makeCustom(batterySleep, acSleep),
        });
      }
      return Promise.resolve({ code: 0, stdout: powerSourceOutput });
    },
  };
}

Deno.test("powerManagementCheck: sleep 0 for both → pass", async () => {
  const result = await powerManagementCheck(makeDeps(0, 0)).run();
  assertEquals(result.status, "pass");
});

Deno.test("powerManagementCheck: battery sleep 1 → fail", async () => {
  const result = await powerManagementCheck(makeDeps(1, 0)).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "Battery");
});

Deno.test("powerManagementCheck: battery sleep 5 → warn", async () => {
  const result = await powerManagementCheck(makeDeps(5, 0)).run();
  assertEquals(result.status, "warn");
});

Deno.test(
  "powerManagementCheck: PreventUserIdleSystemSleep active → pass regardless of sleep",
  async () => {
    const result = await powerManagementCheck(
      makeDeps(1, 1, WITH_ASSERTION),
    ).run();
    assertEquals(result.status, "pass");
    assertStringIncludes(result.detail, "PreventUserIdleSystemSleep");
  },
);

Deno.test(
  "powerManagementCheck: ac sleep 3 and battery sleep 0 → fail",
  async () => {
    const result = await powerManagementCheck(makeDeps(0, 3)).run();
    assertEquals(result.status, "fail");
    assertStringIncludes(result.detail, "AC");
  },
);
