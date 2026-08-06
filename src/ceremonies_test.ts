import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { join } from "@std/path";
import { CeremonyRunner } from "./ceremonies.ts";
import { renderStandup, StandupCeremony } from "./ceremonies/standup.ts";
import { DocumentationGapsCeremony } from "./ceremonies/documentation-gaps.ts";
import { GeminiMeetingNotesCeremony } from "./ceremonies/gemini-meeting-notes.ts";
import { makeTicket } from "./test-support.ts";
import type { TicketState } from "./state/types.ts";
import type { Ceremony } from "./ceremonies/types.ts";

const BASE = { title: "Ticket", url: "https://example.com" };

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

function makeCountedCeremony(
  name: string,
): { ceremony: Ceremony; runCount: () => number } {
  let count = 0;
  const ceremony: Ceremony = {
    name,
    run: async (_now, outputDir) => {
      await Deno.mkdir(outputDir, { recursive: true });
      await Deno.writeTextFile(
        join(outputDir, `${name}-output.md`),
        "output",
      );
      count++;
    },
  };
  return { ceremony, runCount: () => count };
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

Deno.test("CeremonyRunner: interval ceremony skipped on weekend when workdays_only", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "interval-test"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "interval-test", "config.toml"),
      'time = "09:00"\ninterval_hours = 2\nworkdays_only = true\n',
    );
    // 2026-07-25 is a Saturday
    const saturday = Temporal.ZonedDateTime.from(
      "2026-07-25T10:00:00[America/New_York]",
    );
    const { ceremony, runCount } = makeCountedCeremony("interval-test");
    await makeRunner(stateDir, {
      now: () => saturday,
      ceremonies: [ceremony],
    }).run();
    assertEquals(runCount(), 0);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: interval ceremony runs on weekend when workdays_only is false", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "interval-test"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "interval-test", "config.toml"),
      'time = "09:00"\ninterval_hours = 2\nworkdays_only = false\n',
    );
    const saturday = Temporal.ZonedDateTime.from(
      "2026-07-25T10:00:00[America/New_York]",
    );
    const { ceremony, runCount } = makeCountedCeremony("interval-test");
    await makeRunner(stateDir, {
      now: () => saturday,
      ceremonies: [ceremony],
    }).run();
    assertEquals(runCount(), 1);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: interval ceremony skipped when output file is within interval", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const outputDir = join(
      stateDir,
      "ceremonies",
      "interval-test",
      "output",
    );
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "interval-test", "config.toml"),
      'time = "09:00"\ninterval_hours = 2\n',
    );
    // TEST_NOW is 2026-07-27T10:00. A file from 1 hour ago is within the 2-hour interval.
    await Deno.writeTextFile(
      join(outputDir, "20260727T090000-interval-test.md"),
      "prior output",
    );
    const { ceremony, runCount } = makeCountedCeremony("interval-test");
    await makeRunner(stateDir, {
      now: () => TEST_NOW,
      ceremonies: [ceremony],
    }).run();
    assertEquals(runCount(), 0);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: interval ceremony runs when output file is beyond interval", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const outputDir = join(
      stateDir,
      "ceremonies",
      "interval-test",
      "output",
    );
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "interval-test", "config.toml"),
      'time = "09:00"\ninterval_hours = 2\n',
    );
    // 3 hours ago — beyond the 2-hour interval
    await Deno.writeTextFile(
      join(outputDir, "20260727T070000-interval-test.md"),
      "prior output",
    );
    const { ceremony, runCount } = makeCountedCeremony("interval-test");
    await makeRunner(stateDir, {
      now: () => TEST_NOW,
      ceremonies: [ceremony],
    }).run();
    assertEquals(runCount(), 1);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("CeremonyRunner: interval ceremony runs when no prior output file exists", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(stateDir, "ceremonies", "interval-test"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(stateDir, "ceremonies", "interval-test", "config.toml"),
      'time = "09:00"\ninterval_hours = 2\n',
    );
    const { ceremony, runCount } = makeCountedCeremony("interval-test");
    await makeRunner(stateDir, {
      now: () => TEST_NOW,
      ceremonies: [ceremony],
    }).run();
    assertEquals(runCount(), 1);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("renderStandup: active tickets grouped by phase in order", () => {
  const now = TEST_NOW;
  const tickets = [
    makeTicket({
      ...BASE,
      id: "github/org/repo/2",
      phase: "spec",
      status: "running",
    }),
    makeTicket({
      ...BASE,
      id: "github/org/repo/1",
      phase: "intake",
      status: "new",
    }),
    makeTicket({
      ...BASE,
      id: "github/org/repo/3",
      phase: "intake",
      status: "waiting",
    }),
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
    makeTicket({
      ...BASE,
      id: "github/org/repo/1",
      phase: "plan",
      status: "running",
    }),
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
      makeTicket({
        ...BASE,
        id: "github/org/repo/1",
        phase: "merge",
        status: "done",
      }),
      makeTicket({
        ...BASE,
        id: "github/org/repo/2",
        phase: "intake",
        status: "new",
      }),
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

function makeDocumentationGaps(
  stateDir: string,
  _outputDir: string,
  opts: {
    repoDir?: string;
    fetch?: typeof globalThis.fetch;
    commitState?: () => Promise<void>;
    notify?: (title: string, message: string) => Promise<void>;
  } = {},
): DocumentationGapsCeremony {
  return new DocumentationGapsCeremony({
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

Deno.test("DocumentationGapsCeremony: no enrichment files writes no-gaps output without calling fetch", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    let fetchCalled = false;
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
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
    assert(files[0].endsWith("-documentation-gaps.md"));
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertStringIncludes(content, "No uncovered gaps found.");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("DocumentationGapsCeremony: LLM response written verbatim to output file", async () => {
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
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
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

Deno.test("DocumentationGapsCeremony: LLM returning NO_GAPS writes no-gaps output", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const ticketDir = join(stateDir, "github", "org", "repo", "1");
    await Deno.mkdir(ticketDir, { recursive: true });
    await Deno.writeTextFile(
      join(ticketDir, "20260101T000000-enrichment.md"),
      "## Open Questions\n- Which model to use?\n",
    );
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
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

Deno.test("DocumentationGapsCeremony: LLM failure writes error output and still calls commitState", async () => {
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
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
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

Deno.test("DocumentationGapsCeremony: non-OK LLM response writes error output and still calls commitState", async () => {
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
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
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

Deno.test("DocumentationGapsCeremony: notify failure does not abort ceremony", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
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

Deno.test("DocumentationGapsCeremony: prior report headings included in LLM user message", async () => {
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
      join(outputDir, "20260101T060000-documentation-gaps.md"),
      "# Documentation Gap Report\n\n## Previously Reported Theme\n\n**Occurrences:** 3\n",
    );
    let capturedUserMessage = "";
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
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

Deno.test("DocumentationGapsCeremony: documentation corpus content included in LLM user message", async () => {
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
    const ceremony = new DocumentationGapsCeremony({
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

Deno.test("DocumentationGapsCeremony: enrichment file with empty Open Questions section skipped", async () => {
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
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
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

Deno.test("DocumentationGapsCeremony: notify receives lazyboy title and Documentation gaps ready message", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    const notifyCalls: [string, string][] = [];
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
      notify: (title, message) => {
        notifyCalls.push([title, message]);
        return Promise.resolve();
      },
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertEquals(notifyCalls, [["lazyboy", "Documentation gaps ready"]]);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(outputDir, { recursive: true });
  }
});

function makeGeminiCeremony(
  opts: {
    listTickets?: () => Promise<string[]>;
    readTicket?: (id: string) => Promise<TicketState>;
    fetch?: typeof globalThis.fetch;
    runClaude?: (prompt: string) => Promise<string>;
    commitState?: () => Promise<void>;
    notify?: (title: string, message: string) => Promise<void>;
    stateDir?: string;
  } = {},
): GeminiMeetingNotesCeremony {
  return new GeminiMeetingNotesCeremony({
    stateDir: opts.stateDir ?? "/tmp/unused-state",
    listTickets: opts.listTickets ?? (() => Promise.resolve([])),
    readTicket: opts.readTicket ??
      (() => Promise.reject(new Error("not called"))),
    fetch: opts.fetch ??
      (() => Promise.reject(new Error("fetch not expected"))),
    runClaude: opts.runClaude ?? (() => Promise.resolve("assessment result")),
    commitState: opts.commitState ?? (() => Promise.resolve()),
    notify: opts.notify,
  });
}

function driveListResponse(
  files: Array<{ id: string; name: string; createdTime: string }>,
): Response {
  return new Response(JSON.stringify({ files }), { status: 200 });
}

function driveExportResponse(content: string): Response {
  return new Response(content, { status: 200 });
}

Deno.test("GeminiMeetingNotesCeremony: missing GOOGLE_ACCESS_TOKEN returns without writing output", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = join(stateDir, "output");
  await Deno.mkdir(outputDir, { recursive: true });
  const saved = Deno.env.get("GOOGLE_ACCESS_TOKEN");
  Deno.env.delete("GOOGLE_ACCESS_TOKEN");
  try {
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeGeminiCeremony({ commitState });
    await ceremony.run(TEST_NOW, outputDir);
    assertSpyCalls(commitState, 0);
    const files = await outputFiles(outputDir);
    assertEquals(files.length, 0);
  } finally {
    if (saved !== undefined) Deno.env.set("GOOGLE_ACCESS_TOKEN", saved);
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("GeminiMeetingNotesCeremony: Drive API 401 returns without writing output", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = join(stateDir, "output");
  await Deno.mkdir(outputDir, { recursive: true });
  Deno.env.set("GOOGLE_ACCESS_TOKEN", "token");
  try {
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeGeminiCeremony({
      fetch: () =>
        Promise.resolve(new Response("Unauthorized", { status: 401 })),
      commitState,
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertSpyCalls(commitState, 0);
    const files = await outputFiles(outputDir);
    assertEquals(files.length, 0);
  } finally {
    Deno.env.delete("GOOGLE_ACCESS_TOKEN");
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("GeminiMeetingNotesCeremony: no new documents writes no-new-summaries output", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = join(stateDir, "output");
  await Deno.mkdir(outputDir, { recursive: true });
  Deno.env.set("GOOGLE_ACCESS_TOKEN", "token");
  try {
    const seenIds = ["doc-1", "doc-2"];
    await Deno.writeTextFile(
      join(stateDir, "seen.json"),
      JSON.stringify(seenIds),
    );
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeGeminiCeremony({
      fetch: () =>
        Promise.resolve(
          driveListResponse([
            {
              id: "doc-1",
              name: "Meeting notes",
              createdTime: "2026-07-27T09:00:00Z",
            },
            {
              id: "doc-2",
              name: "Meeting notes 2",
              createdTime: "2026-07-26T09:00:00Z",
            },
          ]),
        ),
      commitState,
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertSpyCalls(commitState, 1);
    const files = await outputFiles(outputDir);
    assertEquals(files.length, 1);
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertStringIncludes(content, "No new meeting summaries found.");
    assertStringIncludes(content, "# Gemini Meeting Notes Assessment");
  } finally {
    Deno.env.delete("GOOGLE_ACCESS_TOKEN");
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("GeminiMeetingNotesCeremony: new documents produce assessment output and update seen.json", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = join(stateDir, "output");
  await Deno.mkdir(outputDir, { recursive: true });
  Deno.env.set("GOOGLE_ACCESS_TOKEN", "tok");
  try {
    let capturedPrompt = "";
    const tickets = [
      makeTicket({
        ...BASE,
        id: "github/org/repo/1",
        phase: "plan",
        status: "running",
      }),
    ];
    const ceremony = makeGeminiCeremony({
      listTickets: () => Promise.resolve(tickets.map((t) => t.id)),
      readTicket: (id) => Promise.resolve(tickets.find((t) => t.id === id)!),
      fetch: (url) => {
        if (String(url).includes("/export")) {
          return Promise.resolve(driveExportResponse("Summary text"));
        }
        return Promise.resolve(
          driveListResponse([
            {
              id: "new-doc",
              name: "Meeting notes July 27",
              createdTime: "2026-07-27T10:00:00Z",
            },
          ]),
        );
      },
      runClaude: (prompt) => {
        capturedPrompt = prompt;
        return Promise.resolve("Ticket github/org/repo/1 is affected.");
      },
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertStringIncludes(capturedPrompt, "github/org/repo/1");
    assertStringIncludes(capturedPrompt, "Summary text");
    assertStringIncludes(capturedPrompt, "Meeting notes July 27");
    const files = await outputFiles(outputDir);
    assertEquals(files.length, 1);
    assert(files[0].endsWith("-gemini-meeting-notes.md"));
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertStringIncludes(content, "# Gemini Meeting Notes Assessment");
    assertStringIncludes(content, "Ticket github/org/repo/1 is affected.");
    const seen = JSON.parse(
      await Deno.readTextFile(join(stateDir, "seen.json")),
    );
    assertArrayIncludes(seen, ["new-doc"]);
  } finally {
    Deno.env.delete("GOOGLE_ACCESS_TOKEN");
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("GeminiMeetingNotesCeremony: runClaude failure writes error output and updates seen.json", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = join(stateDir, "output");
  await Deno.mkdir(outputDir, { recursive: true });
  Deno.env.set("GOOGLE_ACCESS_TOKEN", "tok");
  try {
    const ceremony = makeGeminiCeremony({
      fetch: (url) => {
        if (String(url).includes("/export")) {
          return Promise.resolve(driveExportResponse("text"));
        }
        return Promise.resolve(
          driveListResponse([
            {
              id: "doc-fail",
              name: "Meeting notes",
              createdTime: "2026-07-27T10:00:00Z",
            },
          ]),
        );
      },
      runClaude: () => Promise.reject(new Error("claude not found")),
    });
    await ceremony.run(TEST_NOW, outputDir);
    const files = await outputFiles(outputDir);
    assertEquals(files.length, 1);
    const content = await Deno.readTextFile(join(outputDir, files[0]));
    assertStringIncludes(content, "Error: assessment unavailable.");
    const seen = JSON.parse(
      await Deno.readTextFile(join(stateDir, "seen.json")),
    );
    assertArrayIncludes(seen, ["doc-fail"]);
  } finally {
    Deno.env.delete("GOOGLE_ACCESS_TOKEN");
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("GeminiMeetingNotesCeremony: notify failure does not abort ceremony", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = join(stateDir, "output");
  await Deno.mkdir(outputDir, { recursive: true });
  Deno.env.set("GOOGLE_ACCESS_TOKEN", "tok");
  try {
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeGeminiCeremony({
      fetch: () => Promise.resolve(driveListResponse([])),
      commitState,
      notify: () => Promise.reject(new Error("osascript failed")),
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertSpyCalls(commitState, 1);
  } finally {
    Deno.env.delete("GOOGLE_ACCESS_TOKEN");
    await Deno.remove(stateDir, { recursive: true });
  }
});
