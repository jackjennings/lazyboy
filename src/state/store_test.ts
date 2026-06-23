import { assertEquals } from "jsr:@std/assert";
import { join } from "@std/path";
import { readTicket, writeTicket } from "./store.ts";
import type { TicketState } from "./types.ts";

Deno.test("readTicket: parses worktrees from frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-42");
  await Deno.mkdir(ticketDir);
  await Deno.writeTextFile(join(ticketDir, "meta.md"), `---
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
`);
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
  await Deno.writeTextFile(join(ticketDir, "meta.md"), `---
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
`);
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
  assertEquals(read.worktrees["jackjennings/lazyboy"].path, "/tmp/.lazyboy/worktrees/gh-42/jackjennings/lazyboy");
  await Deno.remove(dir, { recursive: true });
});
