import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import {
  answerQuestion,
  applyApproval,
  buildQuestionSystemPrompt,
  classifyApproval,
  findLatestPhaseOutput,
  formatTimestamp,
} from "./review.ts";
import { join } from "@std/path";
import { readTicket, writeTicket } from "./state/store.ts";
import type { TicketState } from "./state/types.ts";

async function initGitRepo(dir: string): Promise<void> {
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();
  await run(["git", "init"]);
  await run(["git", "config", "user.email", "test@example.com"]);
  await run(["git", "config", "user.name", "Test User"]);
  await run(["git", "config", "commit.gpgsign", "false"]);
}

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    id: "gh-1",
    provider: "github",
    title: "T",
    url: "u",
    phase: "spec",
    status: "waiting",
    approved: false,
    scope: [],
    worktrees: {},
    created: "2026-06-29T00:00:00Z",
    updated: "2026-06-29T00:00:00Z",
    body: "",
    ...overrides,
  };
}

function makeApproveResponse(): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: "APPROVE" }] }),
    { status: 200 },
  );
}

function makeFeedbackResponse(): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: "FEEDBACK" }] }),
    { status: 200 },
  );
}

// ── classifyApproval ──────────────────────────────────────────────────────────

Deno.test("classifyApproval: returns true when API responds with APPROVE", async () => {
  const fetcher = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(makeApproveResponse()),
  );
  assertEquals(await classifyApproval("Looks good!", fetcher), true);
  assertSpyCalls(fetcher, 1);
});

Deno.test("classifyApproval: is case-insensitive for APPROVE", async () => {
  const fetcher = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "approve" }] }),
          { status: 200 },
        ),
      ),
  );
  assertEquals(await classifyApproval("continue", fetcher), true);
});

Deno.test(
  "classifyApproval: trims whitespace from response text before comparing",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "  APPROVE  " }],
            }),
            { status: 200 },
          ),
        ),
    );
    assertEquals(await classifyApproval("lgtm", fetcher), true);
  },
);

Deno.test(
  "classifyApproval: returns false when API responds with FEEDBACK",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeFeedbackResponse()),
    );
    assertEquals(await classifyApproval("fix the tests", fetcher), false);
  },
);

Deno.test(
  "classifyApproval: returns false when API responds with unexpected text",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ content: [{ type: "text", text: "YES" }] }),
            { status: 200 },
          ),
        ),
    );
    assertEquals(await classifyApproval("ship it", fetcher), false);
  },
);

Deno.test("classifyApproval: returns false on non-2xx status", async () => {
  const fetcher = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "APPROVE" }] }),
          { status: 401 },
        ),
      ),
  );
  assertEquals(await classifyApproval("approved", fetcher), false);
  assertSpyCalls(fetcher, 1);
});

Deno.test("classifyApproval: returns false when fetch throws", async () => {
  const fetcher = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.reject(new Error("network error")),
  );
  assertEquals(await classifyApproval("approved", fetcher), false);
  assertSpyCalls(fetcher, 1);
});

Deno.test(
  "classifyApproval: returns false without calling fetch when text exceeds 20 characters",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeApproveResponse()),
    );
    const result = await classifyApproval(
      "this is definitely longer than twenty chars",
      fetcher,
    );
    assertEquals(result, false);
    assertSpyCalls(fetcher, 0);
  },
);

Deno.test(
  "classifyApproval: calls fetch when trimmed text is exactly 20 characters",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeFeedbackResponse()),
    );
    await classifyApproval("12345678901234567890", fetcher);
    assertSpyCalls(fetcher, 1);
  },
);

Deno.test(
  "classifyApproval: sends submitted text verbatim as user message content",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeApproveResponse()),
    );
    await classifyApproval("Good to go", fetcher);
    assertSpyCalls(fetcher, 1);
    const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
    assertEquals(body.messages[0].content, "Good to go");
  },
);

Deno.test(
  "classifyApproval: requests model claude-haiku-4-5 with max_tokens 5",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeFeedbackResponse()),
    );
    await classifyApproval("any text", fetcher);
    assertSpyCalls(fetcher, 1);
    const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
    assertEquals(body.model, "claude-haiku-4-5");
    assertEquals(body.max_tokens, 5);
  },
);

Deno.test("classifyApproval: sends the required system prompt", async () => {
  const fetcher = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(makeFeedbackResponse()),
  );
  await classifyApproval("any text", fetcher);
  assertSpyCalls(fetcher, 1);
  const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
  assertEquals(typeof body.system, "string");
  assertEquals(body.system.includes("APPROVE"), true);
  assertEquals(body.system.includes("FEEDBACK"), true);
});

// ── applyApproval ─────────────────────────────────────────────────────────────

Deno.test("applyApproval: sets approved to true on the ticket", async () => {
  const dir = await Deno.makeTempDir();
  await initGitRepo(dir);
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();
  try {
    await writeTicket(dir, makeTicket());
    await run(["git", "add", "-A"]);
    await run(["git", "commit", "-m", "initial"]);
    await applyApproval(dir, "gh-1", Temporal.Now.zonedDateTimeISO("UTC"));
    const ticket = await readTicket(dir, "gh-1");
    assertEquals(ticket.approved, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("applyApproval: leaves status unchanged", async () => {
  const dir = await Deno.makeTempDir();
  await initGitRepo(dir);
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();
  try {
    await writeTicket(dir, makeTicket({ status: "waiting" }));
    await run(["git", "add", "-A"]);
    await run(["git", "commit", "-m", "initial"]);
    await applyApproval(dir, "gh-1", Temporal.Now.zonedDateTimeISO("UTC"));
    const ticket = await readTicket(dir, "gh-1");
    assertEquals(ticket.status, "waiting");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test(
  "applyApproval: sets updated to the provided timestamp",
  async () => {
    const dir = await Deno.makeTempDir();
    await initGitRepo(dir);
    const run = (cmd: string[]) =>
      new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();
    try {
      await writeTicket(dir, makeTicket());
      await run(["git", "add", "-A"]);
      await run(["git", "commit", "-m", "initial"]);
      const now = Temporal.ZonedDateTime.from(
        "2026-06-29T12:00:00+00:00[UTC]",
      );
      await applyApproval(dir, "gh-1", now);
      const ticket = await readTicket(dir, "gh-1");
      assertEquals(ticket.updated, now.toInstant().toString());
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test("applyApproval: commits with message approve: <id>", async () => {
  const dir = await Deno.makeTempDir();
  await initGitRepo(dir);
  const run = (cmd: string[]) =>
    new Deno.Command(cmd[0], { args: cmd.slice(1), cwd: dir }).output();
  try {
    await writeTicket(dir, makeTicket());
    await run(["git", "add", "-A"]);
    await run(["git", "commit", "-m", "initial"]);
    await applyApproval(dir, "gh-1", Temporal.Now.zonedDateTimeISO("UTC"));
    const log = await run(["git", "log", "--oneline", "-1"]);
    const message = new TextDecoder().decode(log.stdout).trim();
    assertEquals(message.endsWith("approve: gh-1"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── findLatestPhaseOutput ─────────────────────────────────────────────────────

Deno.test("findLatestPhaseOutput: returns prefixed output file for the most advanced phase present", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "20260629T154506-spec.md"), "spec");
    const result = await findLatestPhaseOutput(tempDir);
    assertEquals(result?.filename, "20260629T154506-spec.md");
    assertEquals(result?.phaseName, "spec");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("findLatestPhaseOutput: returns lexicographically latest of multiple prefixed files", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "20260629T154506-spec.md"), "v1");
    await Deno.writeTextFile(join(tempDir, "20260629T225507-spec.md"), "v2");
    const result = await findLatestPhaseOutput(tempDir);
    assertEquals(result?.filename, "20260629T225507-spec.md");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("findLatestPhaseOutput: excludes feedback files when finding latest output", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "20260629T154506-spec.md"), "v1");
    await Deno.writeTextFile(
      join(tempDir, "20260629T225507-spec-feedback.md"),
      "fb",
    );
    const result = await findLatestPhaseOutput(tempDir);
    assertEquals(result?.filename, "20260629T154506-spec.md");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("findLatestPhaseOutput: returns null when only old-format canonical file exists", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "spec.md"), "old canonical");
    const result = await findLatestPhaseOutput(tempDir);
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("findLatestPhaseOutput: returns null when ticket directory is empty", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const result = await findLatestPhaseOutput(tempDir);
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ── buildQuestionSystemPrompt ────────────────────────────────────────────────

Deno.test("buildQuestionSystemPrompt: includes fixed framing sentence", async () => {
  const readFile = spy((_path: string | URL) => Promise.resolve("content"));
  const result = await buildQuestionSystemPrompt(
    ["@/ticket/meta.md"],
    readFile,
  );
  assertEquals(
    result.startsWith(
      "You are a helpful assistant answering questions about a ticket's phase output.",
    ),
    true,
  );
});

Deno.test("buildQuestionSystemPrompt: strips leading @ when reading file", async () => {
  const readFile = spy((_path: string | URL) => Promise.resolve("content"));
  await buildQuestionSystemPrompt(["@/ticket/meta.md"], readFile);
  assertSpyCalls(readFile, 1);
  assertEquals(readFile.calls[0].args[0] as string, "/ticket/meta.md");
});

Deno.test("buildQuestionSystemPrompt: includes file content in output", async () => {
  const readFile = spy((_path: string | URL) =>
    Promise.resolve("# Phase Output\n\nSome content.")
  );
  const result = await buildQuestionSystemPrompt(
    ["@/ticket/spec.md"],
    readFile,
  );
  assertEquals(result.includes("# Phase Output"), true);
  assertEquals(result.includes("Some content."), true);
});

Deno.test("buildQuestionSystemPrompt: silently skips unreadable files", async () => {
  const readFile = spy((_path: string | URL) =>
    Promise.reject(new Error("ENOENT"))
  );
  const result = await buildQuestionSystemPrompt(["@/missing.md"], readFile);
  assertEquals(typeof result, "string");
  assertSpyCalls(readFile, 1);
  assertEquals(result.includes("ENOENT"), false);
});

Deno.test("buildQuestionSystemPrompt: separates multiple files with headings", async () => {
  const readFile = spy((_path: string | URL) => Promise.resolve("body"));
  const result = await buildQuestionSystemPrompt(
    ["@/ticket/meta.md", "@/ticket/spec.md"],
    readFile,
  );
  assertSpyCalls(readFile, 2);
  assertEquals(result.includes("/ticket/meta.md"), true);
  assertEquals(result.includes("/ticket/spec.md"), true);
});

// ── answerQuestion ────────────────────────────────────────────────────────────

Deno.test(
  "answerQuestion: appends user then assistant message on success",
  async () => {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "Here is the answer." }],
            }),
            { status: 200 },
          ),
        ),
    );
    await answerQuestion(messages, "What does this do?", "System.", fetcher);
    assertEquals(messages.length, 2);
    assertEquals(messages[0], { role: "user", content: "What does this do?" });
    assertEquals(messages[1], {
      role: "assistant",
      content: "Here is the answer.",
    });
  },
);

Deno.test(
  "answerQuestion: appends error message on non-2xx response",
  async () => {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(new Response("Unauthorized", { status: 401 })),
    );
    await answerQuestion(messages, "What?", "System.", fetcher);
    assertEquals(messages.length, 2);
    assertEquals(messages[1].content, "Error: could not get a response.");
  },
);

Deno.test(
  "answerQuestion: appends error message when fetch throws",
  async () => {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.reject(new Error("network error")),
    );
    await answerQuestion(messages, "What?", "System.", fetcher);
    assertEquals(messages.length, 2);
    assertEquals(messages[1].content, "Error: could not get a response.");
  },
);

Deno.test(
  "answerQuestion: sends full conversation history on each call",
  async () => {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
    ];
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "Second answer." }],
            }),
            { status: 200 },
          ),
        ),
    );
    await answerQuestion(messages, "Second question", "System.", fetcher);
    assertSpyCalls(fetcher, 1);
    const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
    assertEquals(body.messages.length, 3);
    assertEquals(body.messages[0], {
      role: "user",
      content: "First question",
    });
    assertEquals(body.messages[1], {
      role: "assistant",
      content: "First answer",
    });
    assertEquals(body.messages[2], {
      role: "user",
      content: "Second question",
    });
    assertEquals(messages.length, 4);
  },
);

Deno.test("answerQuestion: uses model claude-haiku-4-5", async () => {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const fetcher = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
          { status: 200 },
        ),
      ),
  );
  await answerQuestion(messages, "hi", "System.", fetcher);
  const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
  assertEquals(body.model, "claude-haiku-4-5");
});

Deno.test("answerQuestion: sends system prompt in request body", async () => {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const fetcher = spy(
    (_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
          { status: 200 },
        ),
      ),
  );
  await answerQuestion(messages, "hi", "Custom system prompt.", fetcher);
  const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
  assertEquals(body.system, "Custom system prompt.");
});

// ── formatTimestamp ───────────────────────────────────────────────────────────

Deno.test("formatTimestamp: returns YYYYMMDDTHHMMSS with no hyphens in the date portion", () => {
  const zdt = Temporal.ZonedDateTime.from("2026-06-29T22:46:53+00:00[UTC]");
  assertEquals(formatTimestamp(zdt), "20260629T224653");
});

Deno.test("formatTimestamp: zero-pads single-digit month, day, hour, minute, second", () => {
  const zdt = Temporal.ZonedDateTime.from("2026-01-05T03:07:09+00:00[UTC]");
  assertEquals(formatTimestamp(zdt), "20260105T030709");
});

// ── classifyApproval — apfel path ─────────────────────────────────────────────

function makeApfelApproveResponse(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: "APPROVE" } }] }),
    { status: 200 },
  );
}

function makeApfelFeedbackResponse(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: "FEEDBACK" } }] }),
    { status: 200 },
  );
}

const APFEL_URL = "http://127.0.0.1:11434";

Deno.test(
  "classifyApproval: with apfelUrl, returns true when OpenAI response contains APPROVE",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeApfelApproveResponse()),
    );
    assertEquals(await classifyApproval("lgtm", fetcher, APFEL_URL), true);
    assertSpyCalls(fetcher, 1);
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, is case-insensitive for APPROVE",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: "approve" } }] }),
            { status: 200 },
          ),
        ),
    );
    assertEquals(await classifyApproval("ok", fetcher, APFEL_URL), true);
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, trims whitespace from response before comparing",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "  APPROVE  " } }],
            }),
            { status: 200 },
          ),
        ),
    );
    assertEquals(await classifyApproval("ship it", fetcher, APFEL_URL), true);
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, returns false when response contains FEEDBACK",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeApfelFeedbackResponse()),
    );
    assertEquals(
      await classifyApproval("fix tests", fetcher, APFEL_URL),
      false,
    );
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, returns false on non-2xx status",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: "APPROVE" } }] }),
            { status: 500 },
          ),
        ),
    );
    assertEquals(await classifyApproval("ok", fetcher, APFEL_URL), false);
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, returns false when fetch throws",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.reject(new Error("network error")),
    );
    assertEquals(await classifyApproval("ok", fetcher, APFEL_URL), false);
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, returns false without calling fetch when text exceeds 20 characters",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeApfelApproveResponse()),
    );
    const result = await classifyApproval(
      "this is definitely longer than twenty chars",
      fetcher,
      APFEL_URL,
    );
    assertEquals(result, false);
    assertSpyCalls(fetcher, 0);
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, sends request to apfel chat completions endpoint",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeApfelFeedbackResponse()),
    );
    await classifyApproval("lgtm", fetcher, APFEL_URL);
    assertSpyCalls(fetcher, 1);
    assertEquals(
      fetcher.calls[0].args[0],
      "http://127.0.0.1:11434/v1/chat/completions",
    );
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, sets model apple-foundationmodel and max_tokens 5",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeApfelFeedbackResponse()),
    );
    await classifyApproval("ok", fetcher, APFEL_URL);
    const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
    assertEquals(body.model, "apple-foundationmodel");
    assertEquals(body.max_tokens, 5);
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, sends system prompt as first messages entry with role system",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeApfelFeedbackResponse()),
    );
    await classifyApproval("ok", fetcher, APFEL_URL);
    const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
    assertEquals(body.messages[0].role, "system");
    assertEquals(body.system, undefined);
    assertEquals(typeof body.messages[0].content, "string");
    assertEquals(body.messages[0].content.includes("APPROVE"), true);
    assertEquals(body.messages[0].content.includes("FEEDBACK"), true);
  },
);

Deno.test(
  "classifyApproval: with apfelUrl, sends user text as second messages entry with role user",
  async () => {
    const fetcher = spy(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(makeApfelFeedbackResponse()),
    );
    await classifyApproval("ship it", fetcher, APFEL_URL);
    const body = JSON.parse(fetcher.calls[0].args[1]!.body as string);
    assertEquals(body.messages[1].role, "user");
    assertEquals(body.messages[1].content, "ship it");
  },
);
