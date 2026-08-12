import { assertArrayIncludes, assertEquals, assertFalse } from "@std/assert";
import { desktopNotificationArgs, makeNotify } from "./notify.ts";
import { makeTicket } from "./test-support.ts";

const BASE = { id: "github/jackjennings/lazyboy/8" as const };

function scriptOf(args: string[]): string {
  const separator = args.indexOf("--");
  return args.slice(0, separator).join("\n");
}

Deno.test("makeNotify: passes ticket title and phase as osascript arguments", async () => {
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
  assertArrayIncludes(commandArgs[0], [
    "Fix login (implementation)",
    "github/jackjennings/lazyboy/8",
  ]);
});

Deno.test("makeNotify: includes phase in notification message", async () => {
  const commandArgs: string[][] = [];
  const notify = makeNotify({
    runCommand: (args) => {
      commandArgs.push(args);
      return Promise.resolve({ code: 0 });
    },
  });
  await notify(makeTicket({ ...BASE, title: "Fix login", phase: "spec" }));
  assertArrayIncludes(commandArgs[0], ["Fix login (spec)"]);
});

Deno.test("desktopNotificationArgs: never interpolates values into AppleScript", () => {
  const injection =
    'x" & (do shell script "echo PWNED > /tmp/lazyboy-probe") & "y';
  const message = `Ceremony ${injection} needs approval`;
  const args = desktopNotificationArgs({ title: "lazyboy", message });
  const script = scriptOf(args);
  assertFalse(script.includes("do shell script"));
  assertFalse(script.includes(injection));
  assertArrayIncludes(args, [message]);
});

Deno.test("desktopNotificationArgs: separates arguments from the script with --", () => {
  const args = desktopNotificationArgs({
    title: "title",
    message: "-e is not a flag here",
  });
  const separator = args.indexOf("--");
  assertEquals(args.slice(separator + 1), ["-e is not a flag here", "title"]);
});
