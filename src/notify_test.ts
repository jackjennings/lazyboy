import { assertEquals } from "@std/assert";
import { makeNotify } from "./notify.ts";
import { makeTicket } from "./test-support.ts";

const BASE = { id: "github/jackjennings/lazyboy/8" as const };

Deno.test("makeNotify: calls osascript with ticket title and phase", async () => {
  const commandArgs: string[][] = [];
  const notify = makeNotify({
    runCommand: (args) => {
      commandArgs.push(args);
      return Promise.resolve({ code: 0 });
    },
  });
  await notify(
    makeTicket({ ...BASE, title: "Fix login", phase: "implementation" }),
  );
  assertEquals(commandArgs.length, 1);
  assertEquals(commandArgs[0][0], "osascript");
  assertEquals(
    commandArgs[0][2],
    'display notification "Fix login (implementation)" with title "github/jackjennings/lazyboy/8"',
  );
});

Deno.test("makeNotify: includes phase in notification message", async () => {
  const commandArgs: string[][] = [];
  const notify = makeNotify({
    runCommand: (args) => {
      commandArgs.push(args);
      return Promise.resolve({ code: 0 });
    },
  });
  await notify(
    makeTicket({ ...BASE, title: "Fix login", phase: "spec" }),
  );
  assertEquals(
    commandArgs[0][2],
    'display notification "Fix login (spec)" with title "github/jackjennings/lazyboy/8"',
  );
});
