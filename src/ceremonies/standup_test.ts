import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { toFileUrl } from "@std/path";
import { ModuleCeremony } from "./module.ts";
import { makeTicket } from "../test-support.ts";
import type { TicketState } from "../state/types.ts";

const TEST_NOW = Temporal.ZonedDateTime.from(
  "2026-08-12T10:00:00[America/New_York]",
);
// 2026-08-12 is Wednesday; yesterday = 2026-08-11
const YESTERDAY_ISO = "2026-08-11T18:00:00Z";
const TODAY_ISO = "2026-08-12T08:00:00Z";

const STANDUP_DIR = new URL(
  "../../../lazyboy-state/ceremonies/standup",
  import.meta.url,
).pathname;

function makeStandupCeremony(
  overrides: Partial<ConstructorParameters<typeof ModuleCeremony>[0]> = {},
): ModuleCeremony {
  return new ModuleCeremony({
    name: "standup",
    stateDir: "/state",
    ceremonyDir: STANDUP_DIR,
    appendTickLog: () => Promise.resolve(),
    listTickets: () => Promise.resolve([]),
    readTicket: () => Promise.reject(new Error("not called")),
    generateText: () => Promise.resolve(null),
    commitState: () => Promise.resolve(),
    ...overrides,
  });
}

function makeJiraTicket(overrides: Partial<TicketState> = {}): TicketState {
  return makeTicket({
    provider: "jira",
    id: "jira/NW-1733",
    url: "https://smarterdx.atlassian.net/browse/NW-1733",
    title: "Create technical design document",
    phase: "implementation",
    status: "running",
    updated: YESTERDAY_ISO,
    ...overrides,
  });
}

async function readOutputFile(outputDir: string): Promise<string> {
  for await (const entry of Deno.readDir(outputDir)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      return Deno.readTextFile(join(outputDir, entry.name));
    }
  }
  throw new Error("No output file found in " + outputDir);
}

function phrasedSection(content: string): string {
  const idx = content.indexOf("\n\n## Structured\n\n");
  if (idx === -1) return content;
  return content.slice(0, idx + 1); // include trailing \n
}

function structuredSection(content: string): string {
  const marker = "\n\n## Structured\n\n";
  const idx = content.indexOf(marker);
  if (idx === -1) return "";
  return content.slice(idx + marker.length);
}

Deno.test("standup: output file has ## Structured section", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    const ticket = makeJiraTicket();
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
    }).run(TEST_NOW, outputDir);
    const content = await readOutputFile(outputDir);
    assertStringIncludes(content, "## Structured");
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: ## Structured section contains exact deterministic text", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    const ticket = makeJiraTicket();
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
    }).run(TEST_NOW, outputDir);
    const content = await readOutputFile(outputDir);
    const structured = structuredSection(content);
    assertStringIncludes(
      structured,
      "Worked on implementation for Create technical design document",
    );
    assertStringIncludes(
      structured,
      "[NW-1733](https://smarterdx.atlassian.net/browse/NW-1733)",
    );
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: phrased text used when generateText returns valid text with all URLs", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    const ticket = makeJiraTicket();
    const phrasedText =
      "# Standup — 2026-08-12\n\nY:\n* Wrapped up the design doc today ([NW-1733](https://smarterdx.atlassian.net/browse/NW-1733))\n";
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      generateText: () => Promise.resolve(phrasedText),
    }).run(TEST_NOW, outputDir);
    const content = await readOutputFile(outputDir);
    const phrased = phrasedSection(content);
    assertStringIncludes(phrased, "Wrapped up the design doc today");
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: phrased section does not contain deterministic verb phrases when model succeeds", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    const ticket = makeJiraTicket();
    const phrasedText =
      "# Standup — 2026-08-12\n\nY:\n* Finishing up that design doc ([NW-1733](https://smarterdx.atlassian.net/browse/NW-1733))\n";
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      generateText: () => Promise.resolve(phrasedText),
    }).run(TEST_NOW, outputDir);
    const content = await readOutputFile(outputDir);
    const phrased = phrasedSection(content);
    assertEquals(phrased.includes("Worked on implementation for"), false);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: falls back to structured when generateText returns null", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    const ticket = makeJiraTicket();
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      generateText: () => Promise.resolve(null),
    }).run(TEST_NOW, outputDir);
    const content = await readOutputFile(outputDir);
    const phrased = phrasedSection(content);
    assertStringIncludes(phrased, "Worked on implementation for");
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: falls back to structured when model output is missing a URL", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    const ticket = makeJiraTicket();
    // URL omitted from phrased output
    const missingUrl =
      "# Standup — 2026-08-12\n\nY:\n* Wrapped up the design doc today\n";
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      generateText: () => Promise.resolve(missingUrl),
    }).run(TEST_NOW, outputDir);
    const content = await readOutputFile(outputDir);
    const phrased = phrasedSection(content);
    assertStringIncludes(phrased, "Worked on implementation for");
    assertStringIncludes(
      phrased,
      "[NW-1733](https://smarterdx.atlassian.net/browse/NW-1733)",
    );
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: prior output files are included in the generateText prompt", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(outputDir, "20260810T090000-standup.md"),
      "# Standup — 2026-08-10\n\nY:\n* PRIOR_CONTENT_ALPHA\n",
    );
    await Deno.writeTextFile(
      join(outputDir, "20260811T090000-standup.md"),
      "# Standup — 2026-08-11\n\nY:\n* PRIOR_CONTENT_BETA\n",
    );

    let capturedPrompt = "";
    const ticket = makeJiraTicket();
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      generateText: (req) => {
        capturedPrompt = req.prompt;
        return Promise.resolve(null);
      },
    }).run(TEST_NOW, outputDir);

    assertStringIncludes(capturedPrompt, "PRIOR_CONTENT_ALPHA");
    assertStringIncludes(capturedPrompt, "PRIOR_CONTENT_BETA");
    assertStringIncludes(
      capturedPrompt,
      "Recent standups for phrasing reference",
    );
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: at most 3 prior files passed to generateText", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    // Write 4 prior files; only the 3 most recent should be included
    await Deno.writeTextFile(
      join(outputDir, "20260808T090000-standup.md"),
      "OLDEST_CONTENT\n",
    );
    await Deno.writeTextFile(
      join(outputDir, "20260809T090000-standup.md"),
      "OLD_CONTENT\n",
    );
    await Deno.writeTextFile(
      join(outputDir, "20260810T090000-standup.md"),
      "RECENT_CONTENT\n",
    );
    await Deno.writeTextFile(
      join(outputDir, "20260811T090000-standup.md"),
      "MOST_RECENT_CONTENT\n",
    );

    let capturedPrompt = "";
    const ticket = makeJiraTicket();
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      generateText: (req) => {
        capturedPrompt = req.prompt;
        return Promise.resolve(null);
      },
    }).run(TEST_NOW, outputDir);

    assertEquals(capturedPrompt.includes("OLDEST_CONTENT"), false);
    assertStringIncludes(capturedPrompt, "OLD_CONTENT");
    assertStringIncludes(capturedPrompt, "RECENT_CONTENT");
    assertStringIncludes(capturedPrompt, "MOST_RECENT_CONTENT");
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: generateText called with maxTokens 500", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    let capturedMaxTokens: number | undefined;
    const ticket = makeJiraTicket();
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      generateText: (req) => {
        capturedMaxTokens = req.maxTokens;
        return Promise.resolve(null);
      },
    }).run(TEST_NOW, outputDir);
    assertEquals(capturedMaxTokens, 500);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: generateText called with no prior context when outputDir is empty", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    let capturedPrompt = "";
    const ticket = makeJiraTicket();
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      generateText: (req) => {
        capturedPrompt = req.prompt;
        return Promise.resolve(null);
      },
    }).run(TEST_NOW, outputDir);
    assertEquals(
      capturedPrompt.includes("Recent standups for phrasing reference"),
      false,
    );
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: generateText still called when outputDir does not exist", async () => {
  const tmpParent = await Deno.makeTempDir();
  const outputDir = join(tmpParent, "output");
  try {
    let generateTextCalled = false;
    const ticket = makeJiraTicket();
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      generateText: () => {
        generateTextCalled = true;
        return Promise.resolve(null);
      },
    }).run(TEST_NOW, outputDir);
    assertEquals(generateTextCalled, true);
  } finally {
    await Deno.remove(tmpParent, { recursive: true });
  }
});

Deno.test("standup: works when generateText is omitted from context", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    const ticket = makeJiraTicket();
    const module = await import(
      toFileUrl(join(STANDUP_DIR, "index.ts")).href
    );
    let capturedContent = "";
    await module.default({
      now: TEST_NOW,
      outputDir,
      listTickets: () => Promise.resolve([ticket.id]),
      readTicket: () => Promise.resolve(ticket),
      writeOutput: (content: string) => {
        capturedContent = content;
        return Promise.resolve();
      },
      commitState: () => Promise.resolve(),
      notify: () => Promise.resolve(),
    });
    assertStringIncludes(capturedContent, "## Structured");
    assertStringIncludes(capturedContent, "Worked on implementation for");
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: Y and T sections both present in structured output", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    const yTicket = makeJiraTicket({ updated: YESTERDAY_ISO });
    const tTicket = makeJiraTicket({
      id: "jira/NW-1585",
      url: "https://smarterdx.atlassian.net/browse/NW-1585",
      title: "Adopt design system metrics",
      phase: "merge",
      status: "waiting",
      updated: TODAY_ISO,
    });
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([yTicket.id, tTicket.id]),
      readTicket: (id) =>
        Promise.resolve(id === yTicket.id ? yTicket : tTicket),
    }).run(TEST_NOW, outputDir);
    const content = await readOutputFile(outputDir);
    const structured = structuredSection(content);
    assertStringIncludes(structured, "Y:");
    assertStringIncludes(structured, "T:");
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("standup: URL verification checks all URLs from structured text", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    const yTicket = makeJiraTicket({ updated: YESTERDAY_ISO });
    const tTicket = makeJiraTicket({
      id: "jira/NW-1585",
      url: "https://smarterdx.atlassian.net/browse/NW-1585",
      title: "Adopt design system metrics",
      phase: "merge",
      status: "waiting",
      updated: TODAY_ISO,
    });
    // Model returns text with first URL but not second
    await makeStandupCeremony({
      listTickets: () => Promise.resolve([yTicket.id, tTicket.id]),
      readTicket: (id) =>
        Promise.resolve(id === yTicket.id ? yTicket : tTicket),
      generateText: () =>
        Promise.resolve(
          "# Standup — 2026-08-12\n\nY:\n* Design doc done ([NW-1733](https://smarterdx.atlassian.net/browse/NW-1733))\n\nT:\n* Working on metrics (missing URL here)\n",
        ),
    }).run(TEST_NOW, outputDir);
    const content = await readOutputFile(outputDir);
    const phrased = phrasedSection(content);
    // Falls back because NW-1585 URL is missing
    assertStringIncludes(
      phrased,
      "[NW-1585](https://smarterdx.atlassian.net/browse/NW-1585)",
    );
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});
