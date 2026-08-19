import { assertEquals } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { performTickUpdate } from "./tick.ts";
import type { Divergence } from "./update.ts";

function makeDeps(
  overrides: Partial<Parameters<typeof performTickUpdate>[0]> = {},
) {
  return {
    updateFn: () => Promise.resolve({ status: "current" as const }),
    logFn: () => Promise.resolve(),
    reexecFn: () => Promise.resolve(),
    notifyDivergenceFn: () => Promise.resolve(),
    ...overrides,
  };
}

Deno.test("performTickUpdate: up to date does not log", async () => {
  const logSpy = spy(() => Promise.resolve());
  const result = await performTickUpdate(makeDeps({ logFn: logSpy }));
  assertSpyCalls(logSpy, 0);
  assertEquals(result, true);
});

Deno.test(
  "performTickUpdate: up to date clears any stored divergence",
  async () => {
    const notifySpy = spy((_d: Divergence | null) => Promise.resolve());
    await performTickUpdate(makeDeps({ notifyDivergenceFn: notifySpy }));
    assertSpyCall(notifySpy, 0, { args: [null] });
  },
);

Deno.test(
  "performTickUpdate: real failure logs update-failed and continues",
  async () => {
    const logSpy = spy(() => Promise.resolve());
    const result = await performTickUpdate(makeDeps({
      updateFn: () => Promise.resolve({ status: "failed" as const, code: 1 }),
      logFn: logSpy,
    }));
    assertSpyCall(logSpy, 0, { args: [{ event: "update-failed", code: 1 }] });
    assertEquals(result, true);
  },
);

Deno.test(
  "performTickUpdate: dirty tree logs update-skipped and continues",
  async () => {
    const logSpy = spy(() => Promise.resolve());
    const result = await performTickUpdate(makeDeps({
      updateFn: () => Promise.resolve({ status: "dirty" as const }),
      logFn: logSpy,
    }));
    assertSpyCall(logSpy, 0, {
      args: [{ event: "update-skipped", reason: "dirty" }],
    });
    assertEquals(result, true);
  },
);

Deno.test(
  "performTickUpdate: divergence logs update-skipped with ahead/behind counts",
  async () => {
    const logSpy = spy(() => Promise.resolve());
    const result = await performTickUpdate(makeDeps({
      updateFn: () =>
        Promise.resolve({
          status: "diverged" as const,
          divergence: { ahead: 3, behind: 2 },
        }),
      logFn: logSpy,
    }));
    assertSpyCall(logSpy, 0, {
      args: [{
        event: "update-skipped",
        reason: "diverged",
        ahead: 3,
        behind: 2,
      }],
    });
    assertEquals(result, true);
  },
);

Deno.test(
  "performTickUpdate: divergence is handed to the notifier",
  async () => {
    const notifySpy = spy((_d: Divergence | null) => Promise.resolve());
    await performTickUpdate(makeDeps({
      updateFn: () =>
        Promise.resolve({
          status: "diverged" as const,
          divergence: { ahead: 3, behind: 2 },
        }),
      notifyDivergenceFn: notifySpy,
    }));
    assertSpyCall(notifySpy, 0, { args: [{ ahead: 3, behind: 2 }] });
  },
);

Deno.test(
  "performTickUpdate: dirty tree leaves stored divergence untouched",
  async () => {
    const notifySpy = spy((_d: Divergence | null) => Promise.resolve());
    await performTickUpdate(makeDeps({
      updateFn: () => Promise.resolve({ status: "dirty" as const }),
      notifyDivergenceFn: notifySpy,
    }));
    assertSpyCalls(notifySpy, 0);
  },
);

Deno.test(
  "performTickUpdate: pulled invokes reexec and returns false",
  async () => {
    const reexecSpy = spy((_indexPath: string) => Promise.resolve());
    const result = await performTickUpdate(makeDeps({
      updateFn: () => Promise.resolve({ status: "pulled" as const }),
      reexecFn: reexecSpy,
    }));
    assertSpyCalls(reexecSpy, 1);
    assertEquals(result, false);
  },
);
