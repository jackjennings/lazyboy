import { assertEquals } from "jsr:@std/assert";
import { join } from "@std/path";
import {
  appendTicketLog,
  commitTicket,
  listTickets,
  readTicket,
  writeTicket,
} from "./store.ts";
import type { TicketState } from "./types.ts";

async function initGitRepo(dir: string): Promise<void> {
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();
  await run(["git", "init"]);
  await run(["git", "config", "user.email", "test@example.com"]);
  await run(["git", "config", "user.name", "Test User"]);
}

Deno.test("readTicket: parses worktrees from frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-42");
  await Deno.mkdir(ticketDir);
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-42
provider: github
title: Test
url: https://github.com/jackjennings/lazyboy/issues/42
phase: waiting-intake
approved: false
scope: []
created: "2026-06-22T00:00:00Z"
updated: "2026-06-22T00:00:00Z"
worktrees:
  jackjennings/lazyboy:
    path: /home/user/.lazyboy/worktrees/gh-42/jackjennings/lazyboy
    branch: gh-42
---

body
`,
  );
  const ticket = await readTicket(dir, "gh-42");
  assertEquals(ticket.worktrees, {
    "jackjennings/lazyboy": {
      path: "/home/user/.lazyboy/worktrees/gh-42/jackjennings/lazyboy",
      branch: "gh-42",
    },
  });
  await Deno.remove(dir, { recursive: true });
});

Deno.test("readTicket: defaults worktrees to {} when field absent", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir);
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-1
provider: github
title: Test
url: https://github.com/jackjennings/lazyboy/issues/1
phase: new
approved: false
scope: []
created: "2026-06-22T00:00:00Z"
updated: "2026-06-22T00:00:00Z"
---

body
`,
  );
  const ticket = await readTicket(dir, "gh-1");
  assertEquals(ticket.worktrees, {});
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket: round-trips worktrees through meta.md", async () => {
  const dir = await Deno.makeTempDir();
  const ticket: TicketState = {
    id: "gh-42",
    provider: "github",
    title: "T",
    url: "https://github.com/jackjennings/lazyboy/issues/42",
    phase: "new",
    approved: false,
    scope: [],
    worktrees: {
      "jackjennings/lazyboy": {
        path: "/tmp/.lazyboy/worktrees/gh-42/jackjennings/lazyboy",
        branch: "gh-42",
      },
    },
    created: "2026-06-22T00:00:00Z",
    updated: "2026-06-22T00:00:00Z",
    body: "",
  };
  await writeTicket(dir, ticket);
  const read = await readTicket(dir, "gh-42");
  assertEquals(read.worktrees["jackjennings/lazyboy"].branch, "gh-42");
  assertEquals(
    read.worktrees["jackjennings/lazyboy"].path,
    "/tmp/.lazyboy/worktrees/gh-42/jackjennings/lazyboy",
  );
  await Deno.remove(dir, { recursive: true });
});

Deno.test("listTickets: returns all ticket IDs", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, "gh-1"));
  await Deno.mkdir(join(dir, "gh-2"));
  await Deno.writeTextFile(
    join(dir, "gh-1", "meta.md"),
    "---\nid: gh-1\n---\n",
  );
  await Deno.writeTextFile(
    join(dir, "gh-2", "meta.md"),
    "---\nid: gh-2\n---\n",
  );
  const ids = await listTickets(dir);
  assertEquals(ids.sort(), ["gh-1", "gh-2"]);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("commitTicket: stages only files in the ticket's directory", async () => {
  const dir = await Deno.makeTempDir();
  await initGitRepo(dir);
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();

  await Deno.mkdir(join(dir, "gh-30"));
  await Deno.mkdir(join(dir, "gh-99"));
  await Deno.writeTextFile(
    join(dir, "gh-30", "meta.md"),
    "---\nid: gh-30\n---\n",
  );
  await Deno.writeTextFile(
    join(dir, "gh-99", "meta.md"),
    "---\nid: gh-99\n---\n",
  );
  await run(["git", "add", "-A"]);
  await run(["git", "commit", "-m", "initial"]);

  await Deno.writeTextFile(
    join(dir, "gh-30", "meta.md"),
    "---\nid: gh-30\napproved: true\n---\n",
  );
  await Deno.writeTextFile(
    join(dir, "gh-99", "meta.md"),
    "---\nid: gh-99\nstale: true\n---\n",
  );

  await commitTicket(dir, "gh-30", "approve: gh-30");

  const diffOutput = await run([
    "git",
    "diff",
    "HEAD~1",
    "HEAD",
    "--name-only",
  ]);
  const changedFiles = new TextDecoder().decode(diffOutput.stdout).trim().split(
    "\n",
  ).filter((f) => f);
  assertEquals(changedFiles, ["gh-30/meta.md"]);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("commitTicket: silently succeeds when nothing to commit", async () => {
  const dir = await Deno.makeTempDir();
  await initGitRepo(dir);
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();

  await Deno.mkdir(join(dir, "gh-30"));
  await Deno.writeTextFile(
    join(dir, "gh-30", "meta.md"),
    "---\nid: gh-30\n---\n",
  );
  await run(["git", "add", "-A"]);
  await run(["git", "commit", "-m", "initial"]);

  const headBefore = await run(["git", "rev-parse", "HEAD"]);
  const hashBefore = new TextDecoder().decode(headBefore.stdout).trim();

  await commitTicket(dir, "gh-30", "approve: gh-30");

  const headAfter = await run(["git", "rev-parse", "HEAD"]);
  const hashAfter = new TextDecoder().decode(headAfter.stdout).trim();
  assertEquals(hashBefore, hashAfter);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("appendTicketLog: creates log.ndjson with a single JSON entry", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, "gh-1"));
  await appendTicketLog(dir, "gh-1", {
    event: "phase-transition",
    from: "new",
    to: "running-intake",
  });
  const content = await Deno.readTextFile(join(dir, "gh-1", "log.ndjson"));
  const parsed = JSON.parse(content.trim());
  assertEquals(parsed.event, "phase-transition");
  assertEquals(parsed.from, "new");
  assertEquals(parsed.to, "running-intake");
  assertEquals(typeof parsed.ts, "string");
  assertEquals(isNaN(Date.parse(parsed.ts)), false);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("appendTicketLog: appends successive entries on separate lines", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, "gh-1"));
  await appendTicketLog(dir, "gh-1", { event: "a" });
  await appendTicketLog(dir, "gh-1", { event: "b" });
  const content = await Deno.readTextFile(join(dir, "gh-1", "log.ndjson"));
  const lines = content.trim().split("\n");
  assertEquals(lines.length, 2);
  assertEquals(JSON.parse(lines[0]).event, "a");
  assertEquals(JSON.parse(lines[1]).event, "b");
  await Deno.remove(dir, { recursive: true });
});
