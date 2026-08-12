import { assertEquals } from "@std/assert";
import { judgeComment } from "./judge-comment.ts";

Deno.test("judgeComment: returns true when model returns KEEP", async () => {
  const run = (args: string[]) =>
    args[0] === "apfel"
      ? Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ verdict: "KEEP" }),
      })
      : Promise.resolve({ code: 1, stdout: "" });
  assertEquals(await judgeComment("Substantive technical info", run), true);
});

Deno.test("judgeComment: returns false when model returns SKIP", async () => {
  const run = (args: string[]) =>
    args[0] === "apfel"
      ? Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ verdict: "SKIP" }),
      })
      : Promise.resolve({ code: 1, stdout: "" });
  assertEquals(await judgeComment("Any update?", run), false);
});

Deno.test("judgeComment: defaults to KEEP when both models fail", async () => {
  const run = () => Promise.resolve({ code: 1, stdout: "" });
  assertEquals(await judgeComment("Some comment", run), true);
});
