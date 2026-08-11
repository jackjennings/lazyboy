import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertFalse,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { judgePrinciples } from "./judge-principles.ts";
import type { CommandRunner } from "./apfel.ts";

const KEEP = JSON.stringify({ verdict: "KEEP" });
const SKIP = JSON.stringify({ verdict: "SKIP" });

function runner(
  handler: (args: string[]) => { code: number; stdout: string },
): CommandRunner {
  return spy((args: string[]) => Promise.resolve(handler(args)));
}

function apfelUnavailable(claudeStdout: string) {
  return (args: string[]) =>
    args[0] === "apfel"
      ? { code: 1, stdout: "" }
      : { code: 0, stdout: claudeStdout };
}

function callArgs(run: CommandRunner, index: number): string[] {
  return (run as ReturnType<typeof spy>).calls[index].args[0] as string[];
}

Deno.test("judgePrinciples: calls claude CLI when apfel exits non-zero, returns true on KEEP", async () => {
  const run = runner(apfelUnavailable(KEEP));
  assert(await judgePrinciples("- prefer X over Y", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 2);
});

Deno.test("judgePrinciples: returns false when claude CLI returns SKIP", async () => {
  const run = runner(apfelUnavailable(SKIP));
  assertFalse(await judgePrinciples("_(nothing meets bar)_", run));
});

Deno.test("judgePrinciples: returns false when claude CLI exits non-zero", async () => {
  const run = runner(() => ({ code: 1, stdout: "" }));
  assertFalse(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: returns false when claude CLI throws", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.reject(new Error("not found"))
  );
  assertFalse(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: returns false when claude CLI output is not valid verdict JSON", async () => {
  const run = runner(apfelUnavailable("KEEP, definitely"));
  assertFalse(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: passes body to claude CLI after a -- separator", async () => {
  const run = runner(apfelUnavailable(KEEP));
  await judgePrinciples("- prefer X over Y", run);
  const args = callArgs(run, 1);
  assertEquals(args[0], "claude");
  assertEquals(args[args.length - 2], "--");
  assertEquals(args[args.length - 1], "- prefer X over Y");
});

Deno.test("judgePrinciples: passes --model claude-haiku-4-5 to claude CLI", async () => {
  const run = runner(apfelUnavailable(KEEP));
  await judgePrinciples("- prefer X over Y", run);
  const args = callArgs(run, 1);
  const modelIndex = args.indexOf("--model");
  assertNotEquals(modelIndex, -1);
  assertEquals(args[modelIndex + 1], "claude-haiku-4-5");
});

Deno.test("judgePrinciples: passes the verdict schema inline to claude CLI", async () => {
  const run = runner(apfelUnavailable(KEEP));
  await judgePrinciples("- prefer X over Y", run);
  const args = callArgs(run, 1);
  const schemaIndex = args.indexOf("--json-schema");
  assertNotEquals(schemaIndex, -1);
  const schema = JSON.parse(args[schemaIndex + 1]);
  assertArrayIncludes(schema.required, ["verdict"]);
  assertArrayIncludes(schema.properties.verdict.enum, ["KEEP", "SKIP"]);
});

Deno.test("judgePrinciples: uses apfel first, returns true on KEEP without calling claude", async () => {
  const run = runner(() => ({ code: 0, stdout: KEEP }));
  assert(await judgePrinciples("- prefer X over Y", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 1);
  assertEquals(callArgs(run, 0)[0], "apfel");
});

Deno.test("judgePrinciples: uses apfel first, returns false on SKIP without calling claude", async () => {
  const run = runner(() => ({ code: 0, stdout: SKIP }));
  assertFalse(await judgePrinciples("_(nothing)_", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 1);
});

Deno.test("judgePrinciples: passes body to apfel after a -- separator", async () => {
  const run = runner(() => ({ code: 0, stdout: KEEP }));
  await judgePrinciples("- prefer X over Y", run);
  const args = callArgs(run, 0);
  assertEquals(args[args.length - 2], "--");
  assertEquals(args[args.length - 1], "- prefer X over Y");
});

Deno.test("judgePrinciples: tolerates surrounding whitespace in apfel JSON output", async () => {
  const run = runner(() => ({ code: 0, stdout: `\n${KEEP}\n` }));
  assert(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: falls through to claude when apfel output is not valid verdict JSON", async () => {
  const run = runner((args) =>
    args[0] === "apfel"
      ? { code: 0, stdout: "**KEEP**" }
      : { code: 0, stdout: KEEP }
  );
  assert(await judgePrinciples("- prefer X over Y", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 2);
});

Deno.test("judgePrinciples: passes apfel a schema file holding the verdict schema", async () => {
  let schemaPath = "";
  let schemaContent = "";
  const run = runner((args) => {
    if (args[0] === "apfel") {
      schemaPath = args[args.indexOf("--schema") + 1];
      schemaContent = Deno.readTextFileSync(schemaPath);
    }
    return { code: 0, stdout: KEEP };
  });
  await judgePrinciples("- prefer X over Y", run);

  const schema = JSON.parse(schemaContent);
  assertArrayIncludes(schema.required, ["verdict"]);
  assertArrayIncludes(schema.properties.verdict.enum, ["KEEP", "SKIP"]);
  await assertRejects(() => Deno.stat(schemaPath), Deno.errors.NotFound);
});
