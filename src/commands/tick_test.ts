import { assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { performTickUpdate } from "./tick.ts";

Deno.test("performTickUpdate: up to date does not log", async () => {
  const logSpy = spy(() => Promise.resolve());
  const result = await performTickUpdate({
    updateFn: () => Promise.resolve({ code: 0, pulled: false }),
    logFn: logSpy,
    reexecFn: () => Promise.resolve(),
  });
  assertSpyCalls(logSpy, 0);
  assertEquals(result, true);
});

Deno.test(
  "performTickUpdate: update failure logs update-failed and continues",
  async () => {
    const logSpy = spy(() => Promise.resolve());
    const result = await performTickUpdate({
      updateFn: () => Promise.resolve({ code: 1, pulled: false }),
      logFn: logSpy,
      reexecFn: () => Promise.resolve(),
    });
    assertSpyCall(logSpy, 0, { args: [{ event: "update-failed", code: 1 }] });
    assertEquals(result, true);
  },
);

Deno.test(
  "performTickUpdate: pulled invokes reexec and returns false",
  async () => {
    const reexecSpy = spy((_indexPath: string) => Promise.resolve());
    const result = await performTickUpdate({
      updateFn: () => Promise.resolve({ code: 0, pulled: true }),
      logFn: () => Promise.resolve(),
      reexecFn: reexecSpy,
    });
    assertSpyCalls(reexecSpy, 1);
    assertEquals(result, false);
  },
);
