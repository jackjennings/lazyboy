import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { judgePrinciples } from "./judge-principles.ts";
import type { CommandRunner } from "./apfel.ts";

Deno.test("judgePrinciples: calls claude CLI when apfel exits non-zero, returns true on KEEP", async () => {
  const run: CommandRunner = spy((args: string[]) =>
    Promise.resolve(
      args[0] === "apfel"
        ? { code: 1, stdout: "" }
        : { code: 0, stdout: "KEEP" },
    )
  );
  assert(await judgePrinciples("- prefer X over Y", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 2);
});

Deno.test("judgePrinciples: returns false when claude CLI exits non-zero", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 1, stdout: "" })
  );
  assertFalse(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: returns false when claude CLI throws", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.reject(new Error("not found"))
  );
  assertFalse(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: passes body as second arg to claude CLI", async () => {
  const run: CommandRunner = spy((args: string[]) =>
    Promise.resolve(
      args[0] === "apfel"
        ? { code: 1, stdout: "" }
        : { code: 0, stdout: "KEEP" },
    )
  );
  await judgePrinciples("- prefer X over Y", run);
  const args = (run as ReturnType<typeof spy>).calls[1].args[0] as string[];
  assertEquals(args[0], "claude");
  assertEquals(args[1], "- prefer X over Y");
});

Deno.test("judgePrinciples: passes --model claude-haiku-4-5 to claude CLI", async () => {
  const run: CommandRunner = spy((args: string[]) =>
    Promise.resolve(
      args[0] === "apfel"
        ? { code: 1, stdout: "" }
        : { code: 0, stdout: "KEEP" },
    )
  );
  await judgePrinciples("- prefer X over Y", run);
  const args = (run as ReturnType<typeof spy>).calls[1].args[0] as string[];
  const modelIdx = args.indexOf("--model");
  assertNotEquals(modelIdx, -1);
  assertEquals(args[modelIdx + 1], "claude-haiku-4-5");
});

Deno.test("judgePrinciples: returns true when claude CLI returns KEEP followed by whitespace", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "KEEP\n" })
  );
  assert(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: returns false when claude CLI returns SKIP", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "SKIP" })
  );
  assertFalse(await judgePrinciples("_(nothing meets bar)_", run));
});

Deno.test("judgePrinciples: uses apfel first, returns true on KEEP without calling claude", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "KEEP" })
  );
  assert(await judgePrinciples("- prefer X over Y", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 1);
  const firstCall = (run as ReturnType<typeof spy>).calls[0]
    .args[0] as string[];
  assertEquals(firstCall[0], "apfel");
});

Deno.test("judgePrinciples: uses apfel first, returns false on SKIP without calling claude", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "SKIP" })
  );
  assertFalse(await judgePrinciples("_(nothing)_", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 1);
});

Deno.test("judgePrinciples: passes body as last arg to apfel", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "KEEP" })
  );
  await judgePrinciples("- prefer X over Y", run);
  const args = (run as ReturnType<typeof spy>).calls[0].args[0] as string[];
  assertEquals(args[args.length - 1], "- prefer X over Y");
});

Deno.test("judgePrinciples: apfel KEEP followed by whitespace returns true", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "KEEP " })
  );
  assert(await judgePrinciples("- prefer X over Y", run));
});
