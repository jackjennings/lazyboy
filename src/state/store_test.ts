import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import matter from "gray-matter";
import {
  appendTicketLog,
  commitPrinciples,
  commitTicket,
  listLearnings,
  listTickets,
  readTicket,
  removeLearning,
  writeLearning,
  writeTicket,
} from "./store.ts";
import type { LearningState, TicketState } from "./types.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1",
    provider: "github",
    title: "T",
    url: "https://github.com/x/y/issues/1",
    phase: "intake",
    status: "new",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-07-01T00:00:00Z",
    updated: "2026-07-01T00:00:00Z",
    body: "",
    ...overrides,
  };
}

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

Deno.test("readTicket: migrates old phase format to two fields", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir);
  const metaPath = join(ticketDir, "meta.md");
  await Deno.writeTextFile(
    metaPath,
    `---
id: gh-1
provider: github
title: Test
url: https://github.com/x/y/issues/1
phase: waiting-intake
approved: false
scope: []
created: "2026-06-22T00:00:00Z"
updated: "2026-06-22T00:00:00Z"
---

body
`,
  );
  const ticket = await readTicket(dir, "gh-1");
  assertEquals(ticket.phase, "intake");
  assertEquals(ticket.status, "waiting");
  const { data } = matter(await Deno.readTextFile(metaPath));
  assertEquals(data.phase, "intake");
  assertEquals(data.status, "waiting");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("readTicket: migrates all legacy phase values", async () => {
  const cases: Array<[string, string, string]> = [
    ["new", "intake", "new"],
    ["running-intake", "intake", "running"],
    ["waiting-enrichment", "enrichment", "waiting"],
    ["running-spec", "spec", "running"],
    ["waiting-plan", "plan", "waiting"],
    ["running-implementation", "implementation", "running"],
    ["waiting-diff", "implementation", "waiting"],
    ["waiting-merge", "merge", "waiting"],
    ["needs-attention", "intake", "needs-attention"],
    ["done", "merge", "done"],
  ];
  for (const [oldPhase, expectedPhase, expectedStatus] of cases) {
    const dir = await Deno.makeTempDir();
    const ticketDir = join(dir, "gh-1");
    await Deno.mkdir(ticketDir);
    await Deno.writeTextFile(
      join(ticketDir, "meta.md"),
      `---
id: gh-1
provider: github
title: Test
url: https://github.com/x/y/issues/1
phase: ${oldPhase}
approved: false
scope: []
created: "2026-06-22T00:00:00Z"
updated: "2026-06-22T00:00:00Z"
---
`,
    );
    const ticket = await readTicket(dir, "gh-1");
    assertEquals(ticket.phase, expectedPhase, `phase for old="${oldPhase}"`);
    assertEquals(
      ticket.status,
      expectedStatus,
      `status for old="${oldPhase}"`,
    );
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readTicket: reads new-format file without rewriting", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir);
  const metaPath = join(ticketDir, "meta.md");
  const original = `---
id: gh-1
provider: github
title: Test
url: https://github.com/x/y/issues/1
phase: enrichment
status: waiting
approved: false
scope: []
created: "2026-06-22T00:00:00Z"
updated: "2026-06-22T00:00:00Z"
---

body
`;
  await Deno.writeTextFile(metaPath, original);
  const mtime1 = (await Deno.stat(metaPath)).mtime;
  const ticket = await readTicket(dir, "gh-1");
  assertEquals(ticket.phase, "enrichment");
  assertEquals(ticket.status, "waiting");
  const mtime2 = (await Deno.stat(metaPath)).mtime;
  assertEquals(mtime1?.getTime(), mtime2?.getTime());
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket: persists phase and status as separate YAML fields", async () => {
  const dir = await Deno.makeTempDir();
  const ticket: TicketState = makeTicket({
    id: "gh-5",
    phase: "enrichment",
    status: "running",
  });
  await writeTicket(dir, ticket);
  const { data } = matter(
    await Deno.readTextFile(join(dir, "gh-5", "meta.md")),
  );
  assertEquals(data.phase, "enrichment");
  assertEquals(data.status, "running");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket: round-trips worktrees through meta.md", async () => {
  const dir = await Deno.makeTempDir();
  const ticket: TicketState = makeTicket({
    id: "gh-42",
    url: "https://github.com/jackjennings/lazyboy/issues/42",
    worktrees: {
      "jackjennings/lazyboy": {
        path: "/tmp/.lazyboy/worktrees/gh-42/jackjennings/lazyboy",
        branch: "gh-42",
      },
    },
  });
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
  await Deno.mkdir(
    join(dir, "github", "jackjennings", "lazyboy", "1"),
    { recursive: true },
  );
  await Deno.mkdir(
    join(dir, "github", "jackjennings", "lazyboy", "2"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(dir, "github", "jackjennings", "lazyboy", "1", "meta.md"),
    "---\nid: github/jackjennings/lazyboy/1\n---\n",
  );
  await Deno.writeTextFile(
    join(dir, "github", "jackjennings", "lazyboy", "2", "meta.md"),
    "---\nid: github/jackjennings/lazyboy/2\n---\n",
  );
  const ids = await listTickets(dir);
  assertEquals(ids.sort(), [
    "github/jackjennings/lazyboy/1",
    "github/jackjennings/lazyboy/2",
  ]);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("listTickets: returns empty array when stateDir does not exist", async () => {
  const ids = await listTickets("/nonexistent/state/dir");
  assertEquals(ids, []);
});

Deno.test("listTickets: skips dot-prefixed directories at every depth", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, ".migrations"), { recursive: true });
  await Deno.mkdir(
    join(dir, "github", "jackjennings", "lazyboy", "1"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(dir, ".migrations", "meta.md"),
    "---\nid: .migrations\n---\n",
  );
  await Deno.writeTextFile(
    join(dir, "github", "jackjennings", "lazyboy", "1", "meta.md"),
    "---\nid: github/jackjennings/lazyboy/1\n---\n",
  );
  const ids = await listTickets(dir);
  assertEquals(ids, ["github/jackjennings/lazyboy/1"]);
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
  assertFalse(isNaN(Date.parse(parsed.ts)));
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

Deno.test("appendTicketLog: writes combined log entry with id field", async () => {
  const stateDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", homeDir);
  try {
    await Deno.mkdir(join(stateDir, "github/test/repo/1"), { recursive: true });
    await appendTicketLog(stateDir, "github/test/repo/1", {
      event: "phase-start",
    });
    const combined = await Deno.readTextFile(
      join(homeDir, ".lazyboy", "log.ndjson"),
    );
    const parsed = JSON.parse(combined.trim());
    assertEquals(parsed.id, "github/test/repo/1");
    assertEquals(parsed.event, "phase-start");
    assertEquals(typeof parsed.ts, "string");
  } finally {
    if (originalHome !== undefined) Deno.env.set("HOME", originalHome);
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("appendTicketLog: per-ticket log entry has no id field", async () => {
  const stateDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", homeDir);
  try {
    await Deno.mkdir(join(stateDir, "gh-1"));
    await appendTicketLog(stateDir, "gh-1", { event: "status-transition" });
    const ticket = await Deno.readTextFile(
      join(stateDir, "gh-1", "log.ndjson"),
    );
    const parsed = JSON.parse(ticket.trim());
    assertEquals(parsed.id, undefined);
    assertEquals(parsed.event, "status-transition");
  } finally {
    if (originalHome !== undefined) Deno.env.set("HOME", originalHome);
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("appendTicketLog: primary write succeeds when combined log write fails", async () => {
  const stateDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", homeDir);
  try {
    // make log.ndjson a directory so writeTextFile to it fails
    await Deno.mkdir(join(homeDir, ".lazyboy", "log.ndjson"), {
      recursive: true,
    });
    await Deno.mkdir(join(stateDir, "gh-1"));
    await appendTicketLog(stateDir, "gh-1", { event: "error" });
    const ticket = await Deno.readTextFile(
      join(stateDir, "gh-1", "log.ndjson"),
    );
    assertEquals(JSON.parse(ticket.trim()).event, "error");
  } finally {
    if (originalHome !== undefined) Deno.env.set("HOME", originalHome);
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("readTicket: reads phases field from frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir);
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-1
provider: github
title: T
url: https://github.com/x/y/issues/1
phase: plan
status: waiting
approved: false
scope: []
worktrees: {}
created: "2026-07-01T00:00:00Z"
updated: "2026-07-01T00:00:00Z"
phases:
  implementation:
    model: claude-opus-4-5
    thinking: xhigh
---
`,
  );
  const ticket = await readTicket(dir, "gh-1");
  assertEquals(ticket.phases?.implementation?.model, "claude-opus-4-5");
  assertEquals(ticket.phases?.implementation?.thinking, "xhigh");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket: round-trips phases through meta.md", async () => {
  const dir = await Deno.makeTempDir();
  const ticket: TicketState = makeTicket({
    id: "gh-7",
    phase: "plan",
    status: "waiting",
    phases: { implementation: { model: "claude-opus-4-6", thinking: "high" } },
  });
  await writeTicket(dir, ticket);
  const read = await readTicket(dir, "gh-7");
  assertEquals(read.phases?.implementation?.model, "claude-opus-4-6");
  assertEquals(read.phases?.implementation?.thinking, "high");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket: omits phases key when undefined", async () => {
  const dir = await Deno.makeTempDir();
  const ticket: TicketState = makeTicket({ id: "gh-8" });
  await writeTicket(dir, ticket);
  const raw = await Deno.readTextFile(join(dir, "gh-8", "meta.md"));
  assertFalse(raw.includes("phases:"));
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket: preserves all phases entries on round-trip", async () => {
  const dir = await Deno.makeTempDir();
  const ticket: TicketState = makeTicket({
    id: "gh-phases-test",
    phase: "plan",
    status: "waiting",
    phases: {
      implementation: { model: "claude-sonnet-4-6", thinking: "high" },
      enrichment: { model: "claude-haiku-4-5", thinking: "off" },
    },
  });
  await writeTicket(dir, ticket);
  const read = await readTicket(dir, "gh-phases-test");
  assertEquals(read.phases?.enrichment?.model, "claude-haiku-4-5");
  assertEquals(read.phases?.implementation?.model, "claude-sonnet-4-6");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("readTicket: reads prs array from frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir);
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-1
provider: github
title: T
url: https://github.com/x/y/issues/1
phase: merge
status: waiting
approved: false
scope: []
worktrees: {}
created: "2026-07-01T00:00:00Z"
updated: "2026-07-01T00:00:00Z"
prs:
  - url: https://github.com/x/y/pull/1
    title: my PR
    dependsOn: []
    merged: false
    worktreeKey: x/y
---
`,
  );
  const ticket = await readTicket(dir, "gh-1");
  assertEquals(ticket.prs?.length, 1);
  assertEquals(ticket.prs?.[0].url, "https://github.com/x/y/pull/1");
  assertEquals(ticket.prs?.[0].title, "my PR");
  assertEquals(ticket.prs?.[0].merged, false);
  assertEquals(ticket.prs?.[0].dependsOn, []);
  assertEquals(ticket.prs?.[0].worktreeKey, "x/y");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("readTicket: prs is undefined when neither prs nor prUrl present", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-3");
  await Deno.mkdir(ticketDir);
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-3
provider: github
title: T
url: https://github.com/x/y/issues/3
phase: intake
status: new
approved: false
scope: []
worktrees: {}
created: "2026-07-01T00:00:00Z"
updated: "2026-07-01T00:00:00Z"
---
`,
  );
  const ticket = await readTicket(dir, "gh-3");
  assertEquals(ticket.prs, undefined);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket: round-trips prs array through meta.md", async () => {
  const dir = await Deno.makeTempDir();
  const ticket: TicketState = makeTicket({
    id: "gh-4",
    phase: "merge",
    status: "waiting",
    prs: [{
      url: "https://github.com/x/y/pull/10",
      title: "feat: my PR",
      dependsOn: [],
      merged: false,
      worktreeKey: "x/y",
    }],
  });
  await writeTicket(dir, ticket);
  const read = await readTicket(dir, "gh-4");
  assertEquals(read.prs?.length, 1);
  assertEquals(read.prs?.[0].url, "https://github.com/x/y/pull/10");
  assertEquals(read.prs?.[0].merged, false);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket: does not write approved key to frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeTicket(dir, makeTicket({ approvals: [] }));
    const raw = await Deno.readTextFile(join(dir, "gh-1", "meta.md"));
    assertFalse(raw.includes("approved:"));
    assertStringIncludes(raw, "approvals:");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readTicket: reads approvals array from frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir, { recursive: true });
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-1
provider: github
title: T
url: u
phase: spec
status: waiting
approvals:
  - timestamp: "2026-07-01T00:00:00Z"
    actor: human
    phase: spec
scope: []
worktrees: {}
created: "2026-07-01T00:00:00Z"
updated: "2026-07-01T00:00:00Z"
---

body
`,
  );
  try {
    const ticket = await readTicket(dir, "gh-1");
    assertEquals(ticket.approvals.length, 1);
    assertEquals(ticket.approvals[0].actor, "human");
    assertEquals(ticket.approvals[0].phase, "spec");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readTicket: defaults approvals to [] when field absent", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir, { recursive: true });
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-1
provider: github
title: T
url: u
phase: new
scope: []
worktrees: {}
created: "2026-07-01T00:00:00Z"
updated: "2026-07-01T00:00:00Z"
---

body
`,
  );
  try {
    const ticket = await readTicket(dir, "gh-1");
    assertEquals(ticket.approvals, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeTicket: includes shortTitle in frontmatter when set", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({ shortTitle: "Short form" });
    await writeTicket(dir, ticket);
    const raw = await Deno.readTextFile(join(dir, ticket.id, "meta.md"));
    const { data } = matter(raw);
    assertEquals(data.shortTitle, "Short form");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeTicket: omits shortTitle from frontmatter when not set", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket();
    await writeTicket(dir, ticket);
    const raw = await Deno.readTextFile(join(dir, ticket.id, "meta.md"));
    assertFalse(raw.includes("shortTitle"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readTicket: reads shortTitle from frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir, { recursive: true });
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-1
provider: github
title: A long title for this issue
shortTitle: Short form
url: https://github.com/x/y/issues/1
phase: intake
status: new
approvals: []
scope: []
worktrees: {}
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
---
`,
  );
  const ticket = await readTicket(dir, "gh-1");
  assertEquals(ticket.shortTitle, "Short form");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("readTicket: shortTitle is undefined when absent from frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  const ticketDir = join(dir, "gh-1");
  await Deno.mkdir(ticketDir, { recursive: true });
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: gh-1
provider: github
title: A long title
url: https://github.com/x/y/issues/1
phase: intake
status: new
approvals: []
scope: []
worktrees: {}
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
---
`,
  );
  const ticket = await readTicket(dir, "gh-1");
  assertEquals(ticket.shortTitle, undefined);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("writeTicket/readTicket: outputRetries round-trips through YAML frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const ticket = makeTicket({ outputRetries: 1 });
    await writeTicket(dir, ticket);
    const read = await readTicket(dir, "gh-1");
    assertEquals(read.outputRetries, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeTicket/readTicket: outputRetries absent when undefined", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeTicket(dir, makeTicket());
    const raw = await Deno.readTextFile(join(dir, "gh-1", "meta.md"));
    assertFalse(raw.includes("outputRetries"));
    const read = await readTicket(dir, "gh-1");
    assertEquals(read.outputRetries, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("commitPrinciples: commits principles.md to git", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initGitRepo(dir);
    await Deno.writeTextFile(join(dir, "principles.md"), "- learn A");
    const run = (cmd: string[]) =>
      new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();
    await run(["git", "add", "-A"]);
    await run(["git", "commit", "-m", "init"]);
    await Deno.writeTextFile(
      join(dir, "principles.md"),
      "- learn A\n- learn B",
    );
    await commitPrinciples(dir, "principles: test");
    const log = await run(["git", "log", "--oneline"]);
    const logText = new TextDecoder().decode(log.stdout);
    assertStringIncludes(logText, "principles: test");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("commitPrinciples: succeeds silently when nothing to commit", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initGitRepo(dir);
    await Deno.writeTextFile(join(dir, "principles.md"), "- learn A");
    const run = (cmd: string[]) =>
      new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();
    await run(["git", "add", "-A"]);
    await run(["git", "commit", "-m", "init"]);
    await commitPrinciples(dir, "principles: noop");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

function makeLearning(overrides: Partial<LearningState> = {}): LearningState {
  return {
    id: "20260729T050000",
    ticketId: "github/jackjennings/lazyboy/226",
    repo: "jackjennings/lazyboy",
    targetFile: "src/phases/prompts/implementation.md",
    prTitle:
      "Improve prompt to prevent edit fragmentation observed in github/jackjennings/lazyboy/226",
    prBody: "Body text",
    status: "pending",
    prs: [],
    ...overrides,
  };
}

const INTENT = "Enumerate all call sites before renaming a function.";

Deno.test("writeLearning: writes gray-matter .md with intent as body", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeLearning(dir, makeLearning(), INTENT);
    const raw = await Deno.readTextFile(
      join(dir, "learnings", "20260729T050000.md"),
    );
    const { data, content } = matter(raw);
    assertEquals(data.id, "20260729T050000");
    assertEquals(data.ticketId, "github/jackjennings/lazyboy/226");
    assertEquals(data.repo, "jackjennings/lazyboy");
    assertEquals(data.targetFile, "src/phases/prompts/implementation.md");
    assertEquals(data.status, "pending");
    assertEquals(data.prs, []);
    assertEquals(data.prBody, "Body text");
    assertEquals(content.trim(), INTENT);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test(
  "writeLearning: creates learnings directory when absent",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await writeLearning(dir, makeLearning(), INTENT);
      const stat = await Deno.stat(join(dir, "learnings"));
      assert(stat.isDirectory);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "listLearnings: returns each learning paired with its intent",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await writeLearning(dir, makeLearning({ id: "20260729T050000" }), INTENT);
      await writeLearning(
        dir,
        makeLearning({
          id: "20260729T050001",
          ticketId: "github/jackjennings/lazyboy/227",
        }),
        "Read the file once and hold it in memory.",
      );
      const entries = await listLearnings(dir);
      assertEquals(entries.length, 2);
      const byId = new Map(entries.map((e) => [e.learning.id, e]));
      assertEquals(byId.get("20260729T050000")!.intent, INTENT);
      assertEquals(
        byId.get("20260729T050001")!.intent,
        "Read the file once and hold it in memory.",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "listLearnings: defaults status to pending and prs to [] when omitted",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "learnings"));
      await Deno.writeTextFile(
        join(dir, "learnings", "20260729T050000.md"),
        `---
id: "20260729T050000"
ticketId: github/jackjennings/lazyboy/226
repo: jackjennings/lazyboy
targetFile: src/phases/prompts/implementation.md
prTitle: Improve prompt
prBody: Body text
---

Enumerate all call sites.
`,
      );
      const entries = await listLearnings(dir);
      assertEquals(entries.length, 1);
      assertEquals(entries[0].learning.status, "pending");
      assertEquals(entries[0].learning.prs, []);
      assertEquals(entries[0].intent, "Enumerate all call sites.");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "listLearnings: returns empty array when learnings directory absent",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const entries = await listLearnings(dir);
      assertEquals(entries, []);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "listLearnings: skips files without an id and continues",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "learnings"));
      await Deno.writeTextFile(
        join(dir, "learnings", "bad.md"),
        "no frontmatter here",
      );
      await writeLearning(dir, makeLearning({ id: "20260729T050000" }), INTENT);
      const entries = await listLearnings(dir);
      assertEquals(entries.length, 1);
      assertEquals(entries[0].learning.id, "20260729T050000");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test("removeLearning: deletes the entry file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeLearning(dir, makeLearning({ id: "20260729T050000" }), INTENT);
    await removeLearning(dir, "20260729T050000");
    let threw = false;
    try {
      await Deno.stat(join(dir, "learnings", "20260729T050000.md"));
    } catch {
      threw = true;
    }
    assert(threw);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("removeLearning: is a no-op when file not found", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await removeLearning(dir, "nonexistent");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
