import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import {
  checkApfelAvailable,
  type CommandRunner,
  generateShortTitle,
  startApfelServer,
} from "./apfel.ts";

Deno.test(
  "checkApfelAvailable: returns true when runner exits with code 0",
  async () => {
    const run = spy((_args: string[]) =>
      Promise.resolve({ code: 0, stdout: "" })
    );
    assertEquals(await checkApfelAvailable(run), true);
    assertSpyCalls(run, 1);
  },
);

Deno.test(
  "checkApfelAvailable: returns false when runner exits with code 5",
  async () => {
    const run = spy((_args: string[]) =>
      Promise.resolve({ code: 5, stdout: "" })
    );
    assertEquals(await checkApfelAvailable(run), false);
  },
);

Deno.test(
  "checkApfelAvailable: returns false when runner exits with code 127",
  async () => {
    const run = spy((_args: string[]) =>
      Promise.resolve({ code: 127, stdout: "" })
    );
    assertEquals(await checkApfelAvailable(run), false);
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
    assertEquals(result !== null, true);
    assertEquals(result!.url, "http://127.0.0.1:11434");
    assertEquals(killed.called, false);
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
    assertEquals(killed.called, true);
  },
);

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

Deno.test("generateShortTitle: passes --quiet --max-tokens 40 -s and title to apfel", async () => {
  let capturedArgs: string[] = [];
  const run: CommandRunner = (args) => {
    capturedArgs = args;
    return Promise.resolve({ code: 0, stdout: "Short" });
  };
  await generateShortTitle(run, "Add hud subcommand for live agent status");
  assertEquals(capturedArgs[0], "apfel");
  assertEquals(capturedArgs.includes("--quiet"), true);
  const maxTokensIdx = capturedArgs.indexOf("--max-tokens");
  assertEquals(maxTokensIdx !== -1, true);
  assertEquals(capturedArgs[maxTokensIdx + 1], "40");
  assertEquals(capturedArgs.includes("-s"), true);
  assertEquals(
    capturedArgs[capturedArgs.length - 1],
    "Add hud subcommand for live agent status",
  );
});
