import {
  assertArrayIncludes,
  assertEquals,
  assertFalse,
  assertLess,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import type { CommandRunner } from "./apfel.ts";
import { generateShortTitle } from "./short-title.ts";

Deno.test("generateShortTitle: returns trimmed stdout on exit code 0", async () => {
  const run: CommandRunner = (_args) =>
    Promise.resolve({ code: 0, stdout: " short title \n" });
  const result = await generateShortTitle(
    run,
    "A long full title for an issue",
  );
  assertEquals(result, "short title");
});

Deno.test("generateShortTitle: returns null on non-zero exit code", async () => {
  const run: CommandRunner = (_args) =>
    Promise.resolve({ code: 1, stdout: "ignored" });
  assertEquals(await generateShortTitle(run, "Title"), null);
});

Deno.test("generateShortTitle: returns null on empty stdout", async () => {
  const run: CommandRunner = (_args) =>
    Promise.resolve({ code: 0, stdout: "   " });
  assertEquals(await generateShortTitle(run, "Title"), null);
});

Deno.test("generateShortTitle: returns null when runner throws", async () => {
  const run: CommandRunner = (_args) => Promise.reject(new Error("fail"));
  assertEquals(await generateShortTitle(run, "Title"), null);
});

Deno.test(
  "generateShortTitle: passes --quiet --max-tokens 40 -s and title to apfel",
  async () => {
    let capturedArgs: string[] = [];
    const run: CommandRunner = (args) => {
      capturedArgs = args;
      return Promise.resolve({ code: 0, stdout: "Short" });
    };
    await generateShortTitle(run, "Add hud subcommand for live agent status");
    assertEquals(capturedArgs[0], "apfel");
    assertArrayIncludes(capturedArgs, ["--quiet"]);
    const maxTokensIdx = capturedArgs.indexOf("--max-tokens");
    assertNotEquals(maxTokensIdx, -1);
    assertEquals(capturedArgs[maxTokensIdx + 1], "40");
    assertArrayIncludes(capturedArgs, ["-s"]);
    assertEquals(
      capturedArgs[capturedArgs.length - 1],
      "Add hud subcommand for live agent status",
    );
  },
);

Deno.test(
  "generateShortTitle: includes context in the user prompt when provided",
  async () => {
    let userPrompt = "";
    const run: CommandRunner = (args) => {
      userPrompt = args[args.length - 1];
      return Promise.resolve({ code: 0, stdout: "Short" });
    };
    await generateShortTitle(run, "Fix flaky login test", "Details here.");
    assertStringIncludes(userPrompt, "Fix flaky login test");
    assertStringIncludes(userPrompt, "Details here.");
  },
);

Deno.test(
  "generateShortTitle: truncates oversized context",
  async () => {
    let userPrompt = "";
    const run: CommandRunner = (args) => {
      userPrompt = args[args.length - 1];
      return Promise.resolve({ code: 0, stdout: "Short" });
    };
    await generateShortTitle(run, "Title", "x".repeat(50000));
    assertLess(userPrompt.length, 50000);
    assertFalse(userPrompt.includes("x".repeat(20000)));
  },
);
