import { assertEquals, assertStringIncludes } from "@std/assert";
import { usageSidecarShapeCheck } from "./usage-sidecar-shape.ts";

type Entry = { name: string; isFile: boolean; isDirectory: boolean };

function makeDeps(
  entries: Record<string, Entry[]>,
  files: Record<string, string>,
): Parameters<typeof usageSidecarShapeCheck>[0] {
  return {
    readDir: (path) => {
      const list = entries[path] ?? [];
      return (async function* () {
        for (const e of list) yield e;
      })();
    },
    readTextFile: (path) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Deno.errors.NotFound());
    },
    stateDir: "/state",
  };
}

const VALID_USAGE = JSON.stringify({ durationMs: 1000, models: [] });
const MISSING_DURATION = JSON.stringify({ models: [] });
const NON_ARRAY_MODELS = JSON.stringify({ durationMs: 1000, models: "bad" });
const INVALID_JSON = "not json";

Deno.test("usageSidecarShapeCheck: no usage files → pass", async () => {
  const result = await usageSidecarShapeCheck(
    makeDeps({ "/state": [] }, {}),
  ).run();
  assertEquals(result.status, "pass");
});

Deno.test("usageSidecarShapeCheck: valid usage file → pass", async () => {
  const result = await usageSidecarShapeCheck(makeDeps(
    {
      "/state": [{ name: "tick", isFile: false, isDirectory: true }],
      "/state/tick": [
        { name: "foo.usage.json", isFile: true, isDirectory: false },
      ],
    },
    { "/state/tick/foo.usage.json": VALID_USAGE },
  )).run();
  assertEquals(result.status, "pass");
});

Deno.test(
  "usageSidecarShapeCheck: missing durationMs → fail with filename",
  async () => {
    const result = await usageSidecarShapeCheck(makeDeps(
      {
        "/state": [
          { name: "bad.usage.json", isFile: true, isDirectory: false },
        ],
      },
      { "/state/bad.usage.json": MISSING_DURATION },
    )).run();
    assertEquals(result.status, "fail");
    assertStringIncludes(result.detail, "bad.usage.json");
    assertStringIncludes(result.detail, "durationMs");
  },
);

Deno.test("usageSidecarShapeCheck: models not array → fail", async () => {
  const result = await usageSidecarShapeCheck(makeDeps(
    {
      "/state": [
        { name: "bad.usage.json", isFile: true, isDirectory: false },
      ],
    },
    { "/state/bad.usage.json": NON_ARRAY_MODELS },
  )).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "models");
});

Deno.test("usageSidecarShapeCheck: invalid JSON → fail", async () => {
  const result = await usageSidecarShapeCheck(makeDeps(
    {
      "/state": [
        { name: "bad.usage.json", isFile: true, isDirectory: false },
      ],
    },
    { "/state/bad.usage.json": INVALID_JSON },
  )).run();
  assertEquals(result.status, "fail");
  assertStringIncludes(result.detail, "bad.usage.json");
});
