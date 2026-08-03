import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { checkApfelAvailable, startApfelServer } from "./apfel.ts";

Deno.test(
  "checkApfelAvailable: returns true when runner exits with code 0",
  async () => {
    const run = spy((_args: string[]) =>
      Promise.resolve({ code: 0, stdout: "" })
    );
    assert(await checkApfelAvailable(run));
    assertSpyCalls(run, 1);
  },
);

Deno.test(
  "checkApfelAvailable: returns false when runner exits with code 5",
  async () => {
    const run = spy((_args: string[]) =>
      Promise.resolve({ code: 5, stdout: "" })
    );
    assertFalse(await checkApfelAvailable(run));
  },
);

Deno.test(
  "checkApfelAvailable: returns false when runner exits with code 127",
  async () => {
    const run = spy((_args: string[]) =>
      Promise.resolve({ code: 127, stdout: "" })
    );
    assertFalse(await checkApfelAvailable(run));
  },
);

Deno.test("checkApfelAvailable: runs apfel --model-info", async () => {
  const run = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "" })
  );
  await checkApfelAvailable(run);
  assertEquals(run.calls[0].args[0], ["apfel", "--model-info"]);
});

Deno.test(
  "startApfelServer: spawns apfel --serve --port 11434",
  async () => {
    const spawn = spy((_args: string[]) => ({ kill: () => {} }));
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(new Response("{}", { status: 200 })),
    );
    await startApfelServer(spawn, fetcher);
    assertSpyCalls(spawn, 1);
    assertEquals(spawn.calls[0].args[0], [
      "apfel",
      "--serve",
      "--port",
      "11434",
    ]);
  },
);

Deno.test(
  "startApfelServer: returns server handle when health endpoint responds 200",
  async () => {
    const killed = { called: false };
    const spawn = spy((_args: string[]) => ({
      kill: () => {
        killed.called = true;
      },
    }));
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(new Response("{}", { status: 200 })),
    );
    const result = await startApfelServer(spawn, fetcher);
    assertNotEquals(result, null);
    assertEquals(result!.url, "http://127.0.0.1:11434");
    assertFalse(killed.called);
  },
);

Deno.test(
  "startApfelServer: returns null and kills process when health endpoint unreachable within 2 seconds",
  async () => {
    const killed = { called: false };
    const spawn = spy((_args: string[]) => ({
      kill: () => {
        killed.called = true;
      },
    }));
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.reject(new Error("connection refused")),
    );
    const result = await startApfelServer(spawn, fetcher);
    assertEquals(result, null);
    assert(killed.called);
  },
);
