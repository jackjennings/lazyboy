import { assert, assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { makeNotify } from "./notify.ts";
import type { TicketState } from "./state/types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "github/jackjennings/lazyboy/8",
    provider: "github",
    title: "Fix login",
    url: "u",
    phase: "implementation",
    status: "needs-attention",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-07-25T00:00:00Z",
    updated: "2026-07-25T00:00:00Z",
    body: "",
    artifact: "pr",
    ...overrides,
  };
}

Deno.test("makeNotify: calls osascript with ticket title and phase", async () => {
  const commandArgs: string[][] = [];
  const notify = makeNotify("/state", {
    readLog: () => Promise.resolve(""),
    appendLog: () => Promise.resolve(),
    runCommand: (args) => {
      commandArgs.push(args);
      return Promise.resolve({ code: 0 });
    },
  });
  await notify(makeTicket({ title: "Fix login", phase: "implementation" }));
  assertEquals(commandArgs.length, 1);
  assertEquals(commandArgs[0][0], "osascript");
  assertEquals(
    commandArgs[0][2],
    'display notification "Fix login (implementation)" with title "github/jackjennings/lazyboy/8"',
  );
});

Deno.test(
  "makeNotify: writes sentinel entry to log before calling osascript",
  async () => {
    const sequence: string[] = [];
    const notify = makeNotify("/state", {
      readLog: () => Promise.resolve(""),
      appendLog: (_sd, _id, entry) => {
        sequence.push("append:" + JSON.stringify(entry));
        return Promise.resolve();
      },
      runCommand: () => {
        sequence.push("osascript");
        return Promise.resolve({ code: 0 });
      },
    });
    await notify(makeTicket());
    assert(sequence[0].startsWith("append:"));
    assertEquals(sequence[1], "osascript");
  },
);

Deno.test(
  "makeNotify: sentinel entry has type notified-needs-attention",
  async () => {
    const appended: object[] = [];
    const notify = makeNotify("/state", {
      readLog: () => Promise.resolve(""),
      appendLog: (_sd, _id, entry) => {
        appended.push(entry);
        return Promise.resolve();
      },
      runCommand: () => Promise.resolve({ code: 0 }),
    });
    await notify(makeTicket());
    assertEquals(appended.length, 1);
    assertEquals(
      (appended[0] as Record<string, unknown>).type,
      "notified-needs-attention",
    );
  },
);

Deno.test(
  "makeNotify: does not call osascript when sentinel exists in log",
  async () => {
    const sentinel = JSON.stringify({
      ts: "2026-07-25T00:00:00Z",
      type: "notified-needs-attention",
    });
    const runCommandSpy = spy(() => Promise.resolve({ code: 0 }));
    const notify = makeNotify("/state", {
      readLog: () => Promise.resolve(sentinel + "\n"),
      appendLog: () => Promise.resolve(),
      runCommand: runCommandSpy,
    });
    await notify(makeTicket());
    assertSpyCalls(runCommandSpy, 0);
  },
);

Deno.test(
  "makeNotify: does not write sentinel when sentinel already exists",
  async () => {
    const sentinel = JSON.stringify({
      ts: "2026-07-25T00:00:00Z",
      type: "notified-needs-attention",
    });
    const appendLogSpy = spy((_sd: string, _id: string, _entry: object) =>
      Promise.resolve()
    );
    const notify = makeNotify("/state", {
      readLog: () => Promise.resolve(sentinel + "\n"),
      appendLog: appendLogSpy,
      runCommand: () => Promise.resolve({ code: 0 }),
    });
    await notify(makeTicket());
    assertSpyCalls(appendLogSpy, 0);
  },
);

Deno.test(
  "makeNotify: writes sentinel even when osascript returns non-zero",
  async () => {
    const appended: object[] = [];
    const notify = makeNotify("/state", {
      readLog: () => Promise.resolve(""),
      appendLog: (_sd, _id, entry) => {
        appended.push(entry);
        return Promise.resolve();
      },
      runCommand: () => Promise.resolve({ code: 1 }),
    });
    await notify(makeTicket());
    assertEquals(appended.length, 1);
  },
);

Deno.test(
  "makeNotify: treats empty log as no prior notification",
  async () => {
    const runCommandSpy = spy(() => Promise.resolve({ code: 0 }));
    const notify = makeNotify("/state", {
      readLog: () => Promise.resolve(""),
      appendLog: () => Promise.resolve(),
      runCommand: runCommandSpy,
    });
    await notify(makeTicket());
    assertSpyCalls(runCommandSpy, 1);
  },
);

Deno.test(
  "makeNotify: appends reason from log entry to notification message",
  async () => {
    const commandArgs: string[][] = [];
    const logEntry = JSON.stringify({
      ts: "2026-07-25T00:00:00Z",
      event: "needs-attention",
      reason: "clone-failed",
    });
    const notify = makeNotify("/state", {
      readLog: () => Promise.resolve(logEntry + "\n"),
      appendLog: () => Promise.resolve(),
      runCommand: (args) => {
        commandArgs.push(args);
        return Promise.resolve({ code: 0 });
      },
    });
    await notify(makeTicket({ title: "Fix login", phase: "implementation" }));
    assertEquals(
      commandArgs[0][2],
      'display notification "Fix login (implementation): clone-failed" with title "github/jackjennings/lazyboy/8"',
    );
  },
);

Deno.test(
  "makeNotify: does not append reason when no log entry has a reason field",
  async () => {
    const commandArgs: string[][] = [];
    const logEntry = JSON.stringify({
      ts: "2026-07-25T00:00:00Z",
      event: "phase-transition",
      from: "plan",
      to: "needs-attention",
    });
    const notify = makeNotify("/state", {
      readLog: () => Promise.resolve(logEntry + "\n"),
      appendLog: () => Promise.resolve(),
      runCommand: (args) => {
        commandArgs.push(args);
        return Promise.resolve({ code: 0 });
      },
    });
    await notify(makeTicket({ title: "Fix login", phase: "implementation" }));
    assertEquals(
      commandArgs[0][2],
      'display notification "Fix login (implementation)" with title "github/jackjennings/lazyboy/8"',
    );
  },
);

Deno.test(
  "makeNotify: uses most recent reason entry when multiple log entries have reason",
  async () => {
    const commandArgs: string[][] = [];
    const log = [
      JSON.stringify({
        ts: "2026-07-25T00:00:00Z",
        event: "needs-attention",
        reason: "clone-failed",
      }),
      JSON.stringify({
        ts: "2026-07-25T00:00:01Z",
        event: "needs-attention",
        reason: "worktree-creation-failed",
      }),
    ].join("\n") + "\n";
    const notify = makeNotify("/state", {
      readLog: () => Promise.resolve(log),
      appendLog: () => Promise.resolve(),
      runCommand: (args) => {
        commandArgs.push(args);
        return Promise.resolve({ code: 0 });
      },
    });
    await notify(makeTicket({ title: "Fix login", phase: "implementation" }));
    assertEquals(
      commandArgs[0][2],
      'display notification "Fix login (implementation): worktree-creation-failed" with title "github/jackjennings/lazyboy/8"',
    );
  },
);

Deno.test(
  "makeNotify: passes stateDir and ticket id to appendLog",
  async () => {
    const appended: Array<[string, string, object]> = [];
    const notify = makeNotify("/my/state", {
      readLog: () => Promise.resolve(""),
      appendLog: (sd, id, entry) => {
        appended.push([sd, id, entry]);
        return Promise.resolve();
      },
      runCommand: () => Promise.resolve({ code: 0 }),
    });
    await notify(makeTicket({ id: "github/jackjennings/lazyboy/8" }));
    assertEquals(appended[0][0], "/my/state");
    assertEquals(appended[0][1], "github/jackjennings/lazyboy/8");
  },
);
