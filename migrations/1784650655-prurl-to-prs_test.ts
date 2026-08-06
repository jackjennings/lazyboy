import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import migration from "./1784650655-prurl-to-prs.ts";
import { makeTicket } from "../src/test-support.ts";

async function writeMeta(dir: string, id: string, content: string) {
  const ticketDir = join(dir, ...id.split("/"));
  await Deno.mkdir(ticketDir, { recursive: true });
  await Deno.writeTextFile(join(ticketDir, "meta.md"), content);
}

Deno.test("migration prurl-to-prs: ticket already has prs — returns unchanged", async () => {
  const dir = await Deno.makeTempDir();
  const ticket = makeTicket({
    id: "github/x/y/1",
    url: "https://github.com/x/y/issues/1",
    phase: "merge",
    status: "waiting",
    worktrees: { "x/y": { path: "/wt/x/y", branch: "gh-1" } },
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    prs: [{
      url: "https://github.com/x/y/pull/5",
      title: "existing",
      dependsOn: [],
      merged: false,
    }],
  });
  await writeMeta(
    dir,
    ticket.id,
    `---\nid: github/x/y/1\nprs:\n  - url: https://github.com/x/y/pull/5\n    title: existing\n    dependsOn: []\n    merged: false\n---\n`,
  );
  const result = await migration.run(ticket, dir);
  assertEquals(result.prs?.length, 1);
  assertEquals(result.prs?.[0].url, "https://github.com/x/y/pull/5");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("migration prurl-to-prs: meta.md has prUrl — sets prs with single entry", async () => {
  const dir = await Deno.makeTempDir();
  const ticket = makeTicket({
    id: "github/x/y/1",
    url: "https://github.com/x/y/issues/1",
    phase: "merge",
    status: "waiting",
    worktrees: { "x/y": { path: "/wt/x/y", branch: "gh-1" } },
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    prs: undefined,
  });
  await writeMeta(
    dir,
    ticket.id,
    `---\nid: github/x/y/1\nprUrl: https://github.com/x/y/pull/7\n---\n`,
  );
  const result = await migration.run(ticket, dir);
  assertEquals(result.prs?.length, 1);
  assertEquals(result.prs?.[0].url, "https://github.com/x/y/pull/7");
  assertEquals(result.prs?.[0].title, "");
  assertEquals(result.prs?.[0].dependsOn, []);
  assertEquals(result.prs?.[0].merged, false);
  assertEquals(result.prs?.[0].worktreeKey, "x/y");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("migration prurl-to-prs: meta.md has no prUrl — returns unchanged", async () => {
  const dir = await Deno.makeTempDir();
  const ticket = makeTicket({
    id: "github/x/y/1",
    url: "https://github.com/x/y/issues/1",
    phase: "merge",
    status: "waiting",
    worktrees: { "x/y": { path: "/wt/x/y", branch: "gh-1" } },
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    prs: undefined,
  });
  await writeMeta(
    dir,
    ticket.id,
    `---\nid: github/x/y/1\n---\n`,
  );
  const result = await migration.run(ticket, dir);
  assertEquals(result.prs, undefined);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("migration prurl-to-prs: meta.md not found — returns unchanged", async () => {
  const dir = await Deno.makeTempDir();
  const ticket = makeTicket({
    id: "github/x/y/1",
    url: "https://github.com/x/y/issues/1",
    phase: "merge",
    status: "waiting",
    worktrees: { "x/y": { path: "/wt/x/y", branch: "gh-1" } },
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    prs: undefined,
  });
  const result = await migration.run(ticket, dir);
  assertEquals(result.prs, undefined);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("migration prurl-to-prs: worktreeKey is first key from ticket.worktrees", async () => {
  const dir = await Deno.makeTempDir();
  const ticket = makeTicket({
    id: "github/x/y/1",
    url: "https://github.com/x/y/issues/1",
    phase: "merge",
    status: "waiting",
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    prs: undefined,
    worktrees: {
      "a/repo": { path: "/wt/a/repo", branch: "br" },
      "b/repo": { path: "/wt/b/repo", branch: "br2" },
    },
  });
  await writeMeta(
    dir,
    ticket.id,
    `---\nid: github/x/y/1\nprUrl: https://github.com/a/repo/pull/1\n---\n`,
  );
  const result = await migration.run(ticket, dir);
  assertEquals(result.prs?.[0].worktreeKey, "a/repo");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("migration prurl-to-prs: worktreeKey is undefined when ticket has no worktrees", async () => {
  const dir = await Deno.makeTempDir();
  const ticket = makeTicket({
    id: "github/x/y/1",
    url: "https://github.com/x/y/issues/1",
    phase: "merge",
    status: "waiting",
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    prs: undefined,
    worktrees: {},
  });
  await writeMeta(
    dir,
    ticket.id,
    `---\nid: github/x/y/1\nprUrl: https://github.com/x/y/pull/3\n---\n`,
  );
  const result = await migration.run(ticket, dir);
  assertEquals(result.prs?.[0].worktreeKey, undefined);
  await Deno.remove(dir, { recursive: true });
});
