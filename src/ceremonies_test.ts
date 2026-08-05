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
import { DocumentationGapsCeremony } from "./ceremonies/documentation-gaps.ts";
import { makeTicket } from "./test-support.ts";
import type { TicketState } from "./state/types.ts";
import type { Ceremony } from "./ceremonies/types.ts";
import type { CommandRunner } from "./apfel.ts";

const BASE = { title: "Ticket", url: "https://example.com" };

const TEST_NOW = Temporal.ZonedDateTime.from(
  "2026-07-27T10:00:00[America/New_York]",
);

const JIRA_BASE = {
  provider: "jira",
  id: "jira/FOO-1",
  url: "https://jira.example.com/browse/FOO-1",
  title: "My Feature",
};

// Tuesday; last workday = Monday 2026-07-21
const TUESDAY_NOW = Temporal.ZonedDateTime.from(
  "2026-07-22T10:00:00[America/New_York]",
);

function makeRunner(
  stateDir: string,
  opts: {
    appendTickLog?: (entry: object) => Promise<void>;
    now?: () => Temporal.ZonedDateTime;
    ceremonies?: ConstructorParameters<typeof CeremonyRunner>[1];
    anthropicApiKey?: string;
    fetch?: typeof globalThis.fetch;
  } = {},
): CeremonyRunner {
  return new CeremonyRunner(
    {
      stateDir,
      appendTickLog: opts.appendTickLog ?? (() => Promise.resolve()),
      now: opts.now,
      anthropicApiKey: opts.anthropicApiKey ?? "",
      fetch: opts.fetch,
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

Deno.test("CeremonyRunner: prompt ceremony dir runs PromptCeremony", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    const ceremonyDir = join(stateDir, "ceremonies", "docs-gap");
    await Deno.mkdir(ceremonyDir, { recursive: true });
    await Deno.writeTextFile(
      join(ceremonyDir, "config.toml"),
      'time = "09:00"',
    );
    await Deno.writeTextFile(join(ceremonyDir, "prompt.md"), "List gaps.");

    await makeRunner(stateDir, {
      now: () => TEST_NOW,
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "Gaps found." }],
            }),
            { status: 200 },
          ),
        ),
    }).run();

    const outputDir = join(stateDir, "ceremonies", "docs-gap", "output");
    const files: string[] = [];
    for await (const entry of Deno.readDir(outputDir)) {
      files.push(entry.name);
    }
    assertEquals(files.length, 1);
    assert(files[0].startsWith("20260727"));
    assert(files[0].endsWith("-docs-gap.md"));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test(
  "renderStandup: Jira ticket updated last workday (non-Monday) appears in Y:",
  () => {
    const ticket = makeTicket({
      ...JIRA_BASE,
      phase: "plan",
      status: "running",
      updated: "2026-07-21T14:00:00Z",
    });
    const output = renderStandup(TUESDAY_NOW, [ticket]);
    assertStringIncludes(output, "Y:");
    assertStringIncludes(output, "Worked on plan for");
  },
);

Deno.test(
  "renderStandup: Jira ticket updated Friday appears in Y: when today is Monday",
  () => {
    // TEST_NOW = Monday 2026-07-27; last workday = Friday 2026-07-24
    const ticket = makeTicket({
      ...JIRA_BASE,
      phase: "plan",
      status: "running",
      updated: "2026-07-24T14:00:00Z",
    });
    const output = renderStandup(TEST_NOW, [ticket]);
    assertStringIncludes(output, "Y:");
    assertStringIncludes(output, "Worked on plan for");
  },
);

Deno.test("renderStandup: Jira ticket updated today appears in T:", () => {
  const ticket = makeTicket({
    ...JIRA_BASE,
    phase: "spec",
    status: "running",
    updated: "2026-07-27T14:00:00Z",
  });
  const output = renderStandup(TEST_NOW, [ticket]);
  assertStringIncludes(output, "T:");
  assertStringIncludes(output, "Work on specifications for");
  assertFalse(output.includes("Y:"));
});

Deno.test(
  "renderStandup: merge+done uses Merged pull request for in Y:",
  () => {
    const ticket = makeTicket({
      ...JIRA_BASE,
      phase: "merge",
      status: "done",
      updated: "2026-07-24T14:00:00Z",
    });
    const output = renderStandup(TEST_NOW, [ticket]);
    assertStringIncludes(output, "Merged pull request for");
  },
);

Deno.test(
  "renderStandup: merge+done uses Merged pull request for in T:",
  () => {
    const ticket = makeTicket({
      ...JIRA_BASE,
      phase: "merge",
      status: "done",
      updated: "2026-07-27T14:00:00Z",
    });
    const output = renderStandup(TEST_NOW, [ticket]);
    assertStringIncludes(output, "Merged pull request for");
  },
);

Deno.test("renderStandup: non-Jira tickets are excluded", () => {
  const ticket = makeTicket({
    ...BASE,
    id: "github/org/repo/1",
    phase: "plan",
    status: "running",
    updated: "2026-07-27T14:00:00Z",
  });
  const output = renderStandup(TEST_NOW, [ticket]);
  assertStringIncludes(output, "No Jira tickets.");
  assertFalse(output.includes("github/org/repo/1"));
});

Deno.test(
  "renderStandup: done non-merge tickets appear in the correct section",
  () => {
    const ticket = makeTicket({
      ...JIRA_BASE,
      phase: "spec",
      status: "done",
      updated: "2026-07-27T14:00:00Z",
    });
    const output = renderStandup(TEST_NOW, [ticket]);
    assertStringIncludes(output, "T:");
    assertStringIncludes(output, "Work on specifications for");
  },
);

Deno.test("renderStandup: empty Y: section omits Y: header", () => {
  const ticket = makeTicket({
    ...JIRA_BASE,
    phase: "spec",
    status: "running",
    updated: "2026-07-27T14:00:00Z",
  });
  const output = renderStandup(TEST_NOW, [ticket]);
  assertFalse(output.includes("Y:"));
  assertStringIncludes(output, "T:");
});

Deno.test("renderStandup: empty T: section omits T: header", () => {
  const ticket = makeTicket({
    ...JIRA_BASE,
    phase: "spec",
    status: "running",
    updated: "2026-07-24T14:00:00Z",
  });
  const output = renderStandup(TEST_NOW, [ticket]);
  assertFalse(output.includes("T:"));
  assertStringIncludes(output, "Y:");
});

Deno.test(
  "renderStandup: no Jira tickets in window yields No Jira tickets message",
  () => {
    // Thursday 2026-07-23 is neither today (Mon 2026-07-27) nor last workday (Fri 2026-07-24)
    const ticket = makeTicket({
      ...JIRA_BASE,
      phase: "plan",
      status: "running",
      updated: "2026-07-23T14:00:00Z",
    });
    const output = renderStandup(TEST_NOW, [ticket]);
    assertEquals(output, "# Standup — 2026-07-27\n\nNo Jira tickets.\n");
  },
);

Deno.test("renderStandup: Jira key rendered as markdown link", () => {
  const ticket = makeTicket({
    ...JIRA_BASE,
    phase: "plan",
    status: "running",
    updated: "2026-07-27T14:00:00Z",
  });
  const output = renderStandup(TEST_NOW, [ticket]);
  assertStringIncludes(
    output,
    "([FOO-1](https://jira.example.com/browse/FOO-1))",
  );
});

Deno.test(
  "renderStandup: ticket updated two days ago is excluded from output",
  () => {
    // Monday today; last workday = Friday 2026-07-24; Thursday 2026-07-23 is excluded
    const ticket = makeTicket({
      ...JIRA_BASE,
      phase: "plan",
      status: "running",
      updated: "2026-07-23T14:00:00Z",
    });
    const output = renderStandup(TEST_NOW, [ticket]);
    assertStringIncludes(output, "No Jira tickets.");
  },
);

Deno.test(
  "CeremonyRunner: standup includes done Jira tickets, excludes non-Jira",
  async () => {
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
          provider: "jira",
          id: "jira/FOO-99",
          url: "https://jira.example.com/browse/FOO-99",
          title: "Done Feature",
          phase: "merge",
          status: "done",
          updated: "2026-07-27T14:00:00Z",
        }),
        makeTicket({
          ...BASE,
          id: "github/org/repo/1",
          phase: "intake",
          status: "new",
          updated: "2026-07-27T14:00:00Z",
        }),
      ];
      let written = "";
      const standup = makeStandup({
        listTickets: () => Promise.resolve(tickets.map((t) => t.id)),
        readTicket: (id) => Promise.resolve(tickets.find((t) => t.id === id)!),
      });
      await makeRunner(stateDir, {
        now: () => TEST_NOW,
        ceremonies: [standup],
      }).run();
      const outputDir = join(stateDir, "ceremonies", "standup", "output");
      for await (const entry of Deno.readDir(outputDir)) {
        written = await Deno.readTextFile(join(outputDir, entry.name));
      }
      assertStringIncludes(written, "FOO-99");
      assertFalse(written.includes("github/org/repo/1"));
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

function makeDocumentationGaps(
  stateDir: string,
  _outputDir: string,
  opts: {
    repoDir?: string;
    run?: CommandRunner;
    commitState?: () => Promise<void>;
    notify?: (title: string, message: string) => Promise<void>;
  } = {},
): DocumentationGapsCeremony {
  return new DocumentationGapsCeremony({
    stateDir,
    repoDir: opts.repoDir ?? stateDir,
    run: opts.run ??
      ((_args) => Promise.reject(new Error("run not expected"))),
    commitState: opts.commitState ?? (() => Promise.resolve()),
    notify: opts.notify,
  });
}

async function outputFiles(outputDir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(outputDir)) files.push(entry.name);
  return files;
}

Deno.test("DocumentationGapsCeremony: no enrichment files writes no-gaps output without calling run", async () => {
  const stateDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    let runCalled = false;
    const commitState = spy(() => Promise.resolve());
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
      run: (_args) => {
        runCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
      commitState,
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertFalse(runCalled);
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
      run: (_args) => Promise.resolve({ code: 0, stdout: llmResponse }),
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
      run: (_args) => Promise.resolve({ code: 0, stdout: "NO_GAPS" }),
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
      run: (_args) => Promise.reject(new Error("network error")),
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
      run: (_args) => Promise.resolve({ code: 1, stdout: "" }),
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
      run: (args) => {
        capturedUserMessage = args[args.length - 1] as string;
        return Promise.resolve({ code: 0, stdout: "NO_GAPS" });
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
      run: (args) => {
        capturedUserMessage = args[args.length - 1] as string;
        return Promise.resolve({ code: 0, stdout: "NO_GAPS" });
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
    let runCalled = false;
    const ceremony = makeDocumentationGaps(stateDir, outputDir, {
      run: (_args) => {
        runCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
    });
    await ceremony.run(TEST_NOW, outputDir);
    assertFalse(runCalled);
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
