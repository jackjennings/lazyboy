import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { join } from "@std/path";
import { CeremonyRunner } from "./ceremonies.ts";
import { renderStandup, StandupCeremony } from "./ceremonies/standup.ts";
import type { TicketState } from "./state/types.ts";
import { DocGapsCeremony } from "./ceremonies/doc-gaps.ts";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "github/org/repo/1",
    provider: "github",
    title: "Ticket",
    url: "https://example.com",
    phase: "intake",
    status: "new",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    body: "",
    ...overrides,
  };
}

const TEST_NOW = Temporal.ZonedDateTime.from(
  "2026-07-27T10:00:00[America/New_York]",
);

function makeRunner(
  stateDir: string,
  opts: {
    appendTickLog?: (entry: object) => Promise<void>;
    now?: () => Temporal.ZonedDateTime;
    ceremonies?: ConstructorParameters<typeof CeremonyRunner>[1];
  } = {},
): CeremonyRunner {
  return new CeremonyRunner(
    {
      stateDir,
      appendTickLog: opts.appendTickLog ?? (() => Promise.resolve()),
      now: opts.now,
    },
    opts.ceremonies ?? [],
  );
}

function makeStandup(
  opts: {
    listTickets?: () => Promise<string[]>;
    readTicket?: (id: string) => Promise<TicketState>;
    commitState?: () => Promise<void>;
    notify?: (title: string, message: string) => Promise<void>;
  } = {},
): StandupCeremony {
  return new StandupCeremony({
    listTickets: opts.listTickets ?? (() => Promise.resolve([])),
    readTicket: opts.readTicket ??
      (() => Promise.reject(new Error("not called"))),
    commitState: opts.commitState ?? (() => Promise.resolve()),
    notify: opts.notify,
  });
}

Deno.test("CeremonyRunner: no ceremonies dir does not throw", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await makeRunner(stateDir).run();
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: unknown ceremony directory silently skipped", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "digest"), {
      recursive: true,
    });
    const commitState = spy(() => Promise.resolve());
    const standup = makeStandup({ commitState });
    await makeRunner(stateDir, { now: () => TEST_NOW, ceremonies: [standup] })
      .run();
    assertSpyCalls(commitState, 0);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: standup skipped when no config.toml", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "standup"), {
      recursive: true,
    });
    const commitState = spy(() => Promise.resolve());
    const standup = makeStandup({ commitState });
    await makeRunner(stateDir, { now: () => TEST_NOW, ceremonies: [standup] })
      .run();
    assertSpyCalls(commitState, 0);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: invalid time appends warning and skips ceremony", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "standup"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "standup", "config.toml"),
      'time = "9am"',
    );
    const warnings: object[] = [];
    const commitState = spy(() => Promise.resolve());
    const standup = makeStandup({ commitState });
    await makeRunner(stateDir, {
      appendTickLog: (entry) => {
        warnings.push(entry);
        return Promise.resolve();
      },
      now: () => TEST_NOW,
      ceremonies: [standup],
    }).run();
    assertSpyCalls(commitState, 0);
    assertEquals(warnings.length, 1);
    assertEquals(
      (warnings[0] as Record<string, unknown>).event,
      "ceremony-warning",
    );
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: invalid time 25:00 appends warning and skips ceremony", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "standup"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "standup", "config.toml"),
      'time = "25:00"',
    );
    const warnings: object[] = [];
    const standup = makeStandup();
    await makeRunner(stateDir, {
      appendTickLog: (entry) => {
        warnings.push(entry);
        return Promise.resolve();
      },
      now: () => TEST_NOW,
      ceremonies: [standup],
    }).run();
    assertEquals(warnings.length, 1);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: standup does not fire before configured time", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "standup"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "standup", "config.toml"),
      'time = "23:00"',
    );
    const commitState = spy(() => Promise.resolve());
    const standup = makeStandup({ commitState });
    await makeRunner(stateDir, { now: () => TEST_NOW, ceremonies: [standup] })
      .run();
    assertSpyCalls(commitState, 0);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: standup fires when time has passed", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "standup"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "standup", "config.toml"),
      'time = "09:00"',
    );
    const commitState = spy(() => Promise.resolve());
    const notifyCalls: [string, string][] = [];
    const standup = makeStandup({
      commitState,
      notify: (title, message) => {
        notifyCalls.push([title, message]);
        return Promise.resolve();
      },
    });
    await makeRunner(stateDir, { now: () => TEST_NOW, ceremonies: [standup] })
      .run();
    assertSpyCalls(commitState, 1);
    assertEquals(notifyCalls, [["lazyboy", "Standup ready"]]);
    const outputDir = join(stateDir, "ceremonies", "standup", "output");
    const files: string[] = [];
    for await (const entry of Deno.readDir(outputDir)) {
      files.push(entry.name);
    }
    assertEquals(files.length, 1);
    assert(files[0].endsWith("-standup.md"));
    assert(files[0].startsWith("20260727"));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: standup does not rerun if output file exists for today", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const outputDir = join(stateDir, "ceremonies", "standup", "output");
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "standup", "config.toml"),
      'time = "09:00"',
    );
    await Deno.writeTextFile(
      join(outputDir, "20260727T090000-standup.md"),
      "existing",
    );
    const commitState = spy(() => Promise.resolve());
    const standup = makeStandup({ commitState });
    await makeRunner(stateDir, { now: () => TEST_NOW, ceremonies: [standup] })
      .run();
    assertSpyCalls(commitState, 0);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: notify failure does not prevent ceremony completion", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "standup"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "standup", "config.toml"),
      'time = "09:00"',
    );
    const commitState = spy(() => Promise.resolve());
    const standup = makeStandup({
      commitState,
      notify: () => Promise.reject(new Error("osascript failed")),
    });
    await makeRunner(stateDir, { now: () => TEST_NOW, ceremonies: [standup] })
      .run();
    assertSpyCalls(commitState, 1);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("renderStandup: active tickets grouped by phase in order", () => {
  const now = TEST_NOW;
  const tickets = [
    makeTicket({ id: "github/org/repo/2", phase: "spec", status: "running" }),
    makeTicket({ id: "github/org/repo/1", phase: "intake", status: "new" }),
    makeTicket({ id: "github/org/repo/3", phase: "intake", status: "waiting" }),
  ];
  const output = renderStandup(now, tickets);
  assertEquals(
    output,
    "# Standup — 2026-07-27\n\n## intake\n- [github/org/repo/1] Ticket (new)\n- [github/org/repo/3] Ticket (waiting)\n\n## spec\n- [github/org/repo/2] Ticket (running)\n",
  );
});

Deno.test("renderStandup: omits empty phase sections", () => {
  const now = TEST_NOW;
  const tickets = [
    makeTicket({ id: "github/org/repo/1", phase: "plan", status: "running" }),
  ];
  const output = renderStandup(now, tickets);
  assertFalse(output.includes("## intake"));
  assertStringIncludes(output, "## plan");
});

Deno.test("renderStandup: no active tickets yields no active tickets message", () => {
  const output = renderStandup(TEST_NOW, []);
  assertEquals(
    output,
    "# Standup — 2026-07-27\n\nNo active tickets.\n",
  );
});

Deno.test("CeremonyRunner: standup excludes done tickets", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "standup"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "standup", "config.toml"),
      'time = "09:00"',
    );
    const tickets = [
      makeTicket({ id: "github/org/repo/1", phase: "merge", status: "done" }),
      makeTicket({ id: "github/org/repo/2", phase: "intake", status: "new" }),
    ];
    let written = "";
    const standup = makeStandup({
      listTickets: () => Promise.resolve(tickets.map((t) => t.id)),
      readTicket: (id) => Promise.resolve(tickets.find((t) => t.id === id)!),
    });
    await makeRunner(stateDir, { now: () => TEST_NOW, ceremonies: [standup] })
      .run();
    const outputDir = join(stateDir, "ceremonies", "standup", "output");
    for await (const entry of Deno.readDir(outputDir)) {
      written = await Deno.readTextFile(join(outputDir, entry.name));
    }
    assertFalse(written.includes("github/org/repo/1"));
    assertStringIncludes(written, "github/org/repo/2");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

function makeDocGaps(
  stateDir: string,
  _outputDir: string,
  opts: {
    repoDir?: string;
    fetch?: typeof globalThis.fetch;
    commitState?: () => Promise<void>;
    notify?: (title: string, message: string) => Promise<void>;
  } = {},
): DocGapsCeremony {
  return new DocGapsCeremony({
    stateDir,
    repoDir: opts.repoDir ?? stateDir,
    fetch: opts.fetch ??
      (() => Promise.reject(new Error("fetch not expected"))),
    commitState: opts.commitState ?? (() => Promise.resolve()),
    notify: opts.notify,
  });
}

async function outputFiles(outputDir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(outputDir)) files.push(entry.name);
  return files;
}

Deno.test("DocGapsCeremony: no enrichment files writes no-gaps output without calling fetch", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    let fetchCalled = false;
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeDocGaps(stateDir, outputDir, {
      fetch: () => {
        fetchCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
      commitState,
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertFalse(fetchCalled);
    assertSpyCalls(commitState, 1);
    const files = await outputFiles(outputDir);
    assertEquals(files.length, 1);
    assert(files[0].startsWith("20260727"));
    assert(files[0].endsWith("-doc-gaps.md"));
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertStringIncludes(content, "No uncovered gaps found.");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("DocGapsCeremony: LLM response written verbatim to output file", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const ticketDir = join(stateDir, "github", "org", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260101T000000-enrichment.md"),
      "## Open Questions\n- Which model to use?\n",
    );
    const llmResponse =
      "# Documentation Gap Report\n\n_1 cluster across 1 ticket_\n\n## Model Selection\n\n**Occurrences:** 1\n";
    const ceremony = makeDocGaps(stateDir, outputDir, {
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ content: [{ text: llmResponse }] }), {
            status: 200,
          }),
        ),
    });
    await ceremony.run(TEST_NOW, outputDir);
    const files = await outputFiles(outputDir);
    assertEquals(files.length, 1);
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertEquals(content, llmResponse);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("DocGapsCeremony: LLM returning NO_GAPS writes no-gaps output", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const ticketDir = join(stateDir, "github", "org", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260101T000000-enrichment.md"),
      "## Open Questions\n- Which model to use?\n",
    );
    const ceremony = makeDocGaps(stateDir, outputDir, {
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ content: [{ text: "NO_GAPS" }] }), {
            status: 200,
          }),
        ),
    });
    await ceremony.run(TEST_NOW, outputDir);
    const files = await outputFiles(outputDir);
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertStringIncludes(content, "No uncovered gaps found.");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("DocGapsCeremony: LLM failure writes error output and still calls commitState", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const ticketDir = join(stateDir, "github", "org", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260101T000000-enrichment.md"),
      "## Open Questions\n- Which model to use?\n",
    );
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeDocGaps(stateDir, outputDir, {
      fetch: () => Promise.reject(new Error("network error")),
      commitState,
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertSpyCalls(commitState, 1);
    const files = await outputFiles(outputDir);
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertStringIncludes(content, "Error:");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("DocGapsCeremony: non-OK LLM response writes error output and still calls commitState", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const ticketDir = join(stateDir, "github", "org", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260101T000000-enrichment.md"),
      "## Open Questions\n- Which model to use?\n",
    );
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeDocGaps(stateDir, outputDir, {
      fetch: () =>
        Promise.resolve(new Response("Unauthorized", { status: 401 })),
      commitState,
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertSpyCalls(commitState, 1);
    const files = await outputFiles(outputDir);
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertStringIncludes(content, "Error:");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("DocGapsCeremony: notify failure does not abort ceremony", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeDocGaps(stateDir, outputDir, {
      commitState,
      notify: () => Promise.reject(new Error("osascript failed")),
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertSpyCalls(commitState, 1);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("DocGapsCeremony: prior report headings included in LLM user message", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const ticketDir = join(stateDir, "github", "org", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260101T000000-enrichment.md"),
      "## Open Questions\n- Which model to use?\n",
    );
    await Deno.writeTextFile(
      join(outputDir, "20260101T060000-doc-gaps.md"),
      "# Documentation Gap Report\n\n## Previously Reported Theme\n\n**Occurrences:** 3\n",
    );
    let capturedUserMessage = "";
    const ceremony = makeDocGaps(stateDir, outputDir, {
      fetch: (_url, init) => {
        const body = JSON.parse(init!.body as string);
        capturedUserMessage = body.messages[0].content;
        return Promise.resolve(
          new Response(JSON.stringify({ content: [{ text: "NO_GAPS" }] }), {
            status: 200,
          }),
        );
      },
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertStringIncludes(capturedUserMessage, "Previously Reported Theme");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("DocGapsCeremony: doc corpus content included in LLM user message", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const repoDir = await Deno.makeTempDir();
  try {
    const ticketDir = join(stateDir, "github", "org", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260101T000000-enrichment.md"),
      "## Open Questions\n- Which model to use?\n",
    );
    await Deno.writeTextFile(
      join(repoDir, "AGENTS.md"),
      "# Agent Instructions\n\nSENTINEL_CORPUS_CONTENT\n",
    );
    let capturedUserMessage = "";
    const ceremony = new DocGapsCeremony({
      stateDir,
      repoDir,
      fetch: (_url, init) => {
        const body = JSON.parse(init!.body as string);
        capturedUserMessage = body.messages[0].content;
        return Promise.resolve(
          new Response(JSON.stringify({ content: [{ text: "NO_GAPS" }] }), {
            status: 200,
          }),
        );
      },
      commitState: () => Promise.resolve(),
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertStringIncludes(capturedUserMessage, "SENTINEL_CORPUS_CONTENT");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
    await Deno.remove(repoDir, { recursive: true });
  }
});

Deno.test("DocGapsCeremony: enrichment file with empty Open Questions section skipped", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const ticketDir = join(stateDir, "github", "org", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260101T000000-enrichment.md"),
      "## Open Questions\n## Next Section\nSome content.\n",
    );
    let fetchCalled = false;
    const ceremony = makeDocGaps(stateDir, outputDir, {
      fetch: () => {
        fetchCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertFalse(fetchCalled);
    const files = await outputFiles(outputDir);
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertStringIncludes(content, "No uncovered gaps found.");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("DocGapsCeremony: notify receives lazyboy title and Doc gaps ready message", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const notifyCalls: [string, string][] = [];
    const ceremony = makeDocGaps(stateDir, outputDir, {
      notify: (title, message) => {
        notifyCalls.push([title, message]);
        return Promise.resolve();
      },
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertEquals(notifyCalls, [["lazyboy", "Doc gaps ready"]]);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});
