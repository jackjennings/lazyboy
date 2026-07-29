import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { STATUS_SEQUENCE } from "../state/types.ts";
import type { TicketState, TicketStatus } from "../state/types.ts";
import {
  compareTickets,
  formatDetailView,
  formatStatusHeader,
  formatStatusRow,
  formatTokens,
  readTicketCost,
  readTicketTokens,
  shouldHideTicket,
  status,
} from "./status.ts";

function makeTicket(overrides: Partial<TicketState>): TicketState {
  return {
    id: "github/a/repo/1",
    provider: "github",
    title: "test",
    url: "",
    phase: "intake",
    status: "running",
    approvals: [],
    scope: [],
    worktrees: {},
    created: "",
    updated: "",
    body: "",
    ...overrides,
  };
}

// ── compareTickets ────────────────────────────────────────────────────────────

Deno.test("compareTickets: orders by status index within same phase", () => {
  const a = makeTicket({ phase: "spec", status: "new" });
  const b = makeTicket({ phase: "spec", status: "waiting" });
  assertEquals(compareTickets(a, b) < 0, true);
  assertEquals(compareTickets(b, a) > 0, true);
});

Deno.test("compareTickets: phase difference overrides status", () => {
  const a = makeTicket({ phase: "intake", status: "needs-attention" });
  const b = makeTicket({ phase: "spec", status: "new" });
  assertEquals(compareTickets(a, b) < 0, true);
});

Deno.test("compareTickets: same phase and status orders by provider then id", () => {
  const a = makeTicket({
    phase: "spec",
    status: "running",
    provider: "github",
    id: "github/a/repo/1",
  });
  const b = makeTicket({
    phase: "spec",
    status: "running",
    provider: "github",
    id: "github/a/repo/2",
  });
  assertEquals(compareTickets(a, b) < 0, true);
});

Deno.test("compareTickets: unknown status sorts last within phase", () => {
  const a = makeTicket({ phase: "intake", status: "done" as TicketStatus });
  const b = makeTicket({
    phase: "intake",
    status: "unrecognized" as TicketStatus,
  });
  assertEquals(compareTickets(a, b) < 0, true);
});

// ── STATUS_SEQUENCE ───────────────────────────────────────────────────────────

Deno.test("STATUS_SEQUENCE is exported and ordered correctly", () => {
  assertEquals(STATUS_SEQUENCE[0], "new");
  assertEquals(STATUS_SEQUENCE[STATUS_SEQUENCE.length - 1], "done");
  assertEquals(
    STATUS_SEQUENCE.indexOf("running") < STATUS_SEQUENCE.indexOf("waiting"),
    true,
  );
  assertEquals(
    STATUS_SEQUENCE.indexOf("waiting") < STATUS_SEQUENCE.indexOf("revising"),
    true,
  );
  assertEquals(
    STATUS_SEQUENCE.indexOf("revising") <
      STATUS_SEQUENCE.indexOf("needs-attention"),
    true,
  );
  assertEquals(
    STATUS_SEQUENCE.indexOf("needs-attention") <
      STATUS_SEQUENCE.indexOf("done"),
    true,
  );
});

// ── formatTokens ─────────────────────────────────────────────────────────────

Deno.test("formatTokens: returns em-dash for null", () => {
  assertEquals(formatTokens(null), "—");
});

Deno.test("formatTokens: returns plain integer string for totals under 1000", () => {
  assertEquals(formatTokens(0), "0");
  assertEquals(formatTokens(999), "999");
  assertEquals(formatTokens(500), "500");
});

Deno.test("formatTokens: returns Xk with one decimal for totals >= 1000", () => {
  assertEquals(formatTokens(1000), "1.0k");
  assertEquals(formatTokens(3300), "3.3k");
  assertEquals(formatTokens(3350), "3.4k");
  assertEquals(formatTokens(10000), "10.0k");
});

// ── readTicketTokens ─────────────────────────────────────────────────────────

Deno.test("readTicketTokens: returns null when no usage files exist", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const result = await readTicketTokens(tempDir);
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "readTicketTokens: sums all four token fields across all usage files",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "20260715T190000-intake.usage.json"),
        JSON.stringify({
          input: 10,
          output: 5,
          cacheRead: 100,
          cacheWrite: 50,
          model: "claude-sonnet-4-6",
          durationMs: 1000,
        }),
      );
      await Deno.writeTextFile(
        join(tempDir, "20260715T192000-enrichment.usage.json"),
        JSON.stringify({
          input: 20,
          output: 8,
          cacheRead: 200,
          cacheWrite: 30,
          model: "claude-sonnet-4-6",
          durationMs: 2000,
        }),
      );
      const result = await readTicketTokens(tempDir);
      assertEquals(result, 10 + 5 + 100 + 50 + 20 + 8 + 200 + 30);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "readTicketTokens: returns null when usage files cannot be parsed",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "20260715T190000-intake.usage.json"),
        "not-json",
      );
      const result = await readTicketTokens(tempDir);
      assertEquals(result, null);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test("readTicketTokens: ignores non-usage json files", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260715T190000-intake.usage.json"),
      JSON.stringify({
        input: 5,
        output: 3,
        cacheRead: 20,
        cacheWrite: 10,
        model: "claude-sonnet-4-6",
        durationMs: 500,
      }),
    );
    const result = await readTicketTokens(tempDir);
    assertEquals(result, 38);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ── formatStatusRow / formatStatusHeader ─────────────────────────────────────

Deno.test("formatStatusRow: pads ID field to 36 characters", () => {
  const row = formatStatusRow(
    "github/jackjennings/lazyboy/23",
    "intake",
    "running",
    [],
    "0",
    "My ticket",
  );
  assertEquals(row.startsWith("github/jackjennings/lazyboy/23      "), true);
});

Deno.test("formatStatusHeader: separator line is 117 characters", () => {
  const lines = formatStatusHeader().split("\n");
  assertEquals(lines[1].length, 117);
});

// ── shouldHideTicket ──────────────────────────────────────────────────────────

Deno.test("shouldHideTicket: returns true for merge/done", () => {
  assertEquals(shouldHideTicket("merge", "done"), true);
});

Deno.test("shouldHideTicket: returns true for wont-do (any status)", () => {
  assertEquals(shouldHideTicket("wont-do", "done"), true);
});

Deno.test("shouldHideTicket: returns false for merge/running", () => {
  assertEquals(shouldHideTicket("merge", "running"), false);
});

Deno.test("shouldHideTicket: returns false for active phases", () => {
  assertEquals(shouldHideTicket("intake", "running"), false);
  assertEquals(shouldHideTicket("implementation", "waiting"), false);
});

// ── readTicketCost ────────────────────────────────────────────────────────────

Deno.test("readTicketCost: returns null/false when no usage files exist", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const result = await readTicketCost(tempDir);
    assertEquals(result, { cost: null, partial: false });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "readTicketCost: returns null/false when usage files have no costUsd",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "20260715T190000-intake.usage.json"),
        JSON.stringify({
          input: 10,
          output: 5,
          cacheRead: 100,
          cacheWrite: 50,
          model: "claude-sonnet-4-6",
          durationMs: 1000,
        }),
      );
      const result = await readTicketCost(tempDir);
      assertEquals(result, { cost: null, partial: false });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "readTicketCost: returns summed cost/false when all files have costUsd",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "20260715T190000-intake.usage.json"),
        JSON.stringify({
          input: 10,
          output: 5,
          cacheRead: 100,
          cacheWrite: 50,
          model: "claude-sonnet-4-6",
          durationMs: 1000,
          costUsd: 0.50,
        }),
      );
      await Deno.writeTextFile(
        join(tempDir, "20260715T192000-enrichment.usage.json"),
        JSON.stringify({
          input: 20,
          output: 8,
          cacheRead: 200,
          cacheWrite: 30,
          model: "claude-sonnet-4-6",
          durationMs: 2000,
          costUsd: 0.75,
        }),
      );
      const result = await readTicketCost(tempDir);
      assertEquals(result, { cost: 1.25, partial: false });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "readTicketCost: returns partial sum/true when only some files have costUsd",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "20260715T190000-intake.usage.json"),
        JSON.stringify({
          input: 10,
          output: 5,
          cacheRead: 100,
          cacheWrite: 50,
          model: "claude-sonnet-4-6",
          durationMs: 1000,
          costUsd: 0.50,
        }),
      );
      await Deno.writeTextFile(
        join(tempDir, "20260715T192000-enrichment.usage.json"),
        JSON.stringify({
          input: 20,
          output: 8,
          cacheRead: 200,
          cacheWrite: 30,
          model: "claude-sonnet-4-6",
          durationMs: 2000,
        }),
      );
      const result = await readTicketCost(tempDir);
      assertEquals(result, { cost: 0.50, partial: true });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

// ── formatDetailView ──────────────────────────────────────────────────────────

Deno.test("formatDetailView: renders phase and status", () => {
  const ticket = makeTicket({ phase: "spec", status: "running" });
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertEquals(out.startsWith("Phase    spec\nStatus   running\n"), true);
});

Deno.test("formatDetailView: renders em-dash for null tokens", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertEquals(out.includes("Tokens   —"), true);
});

Deno.test("formatDetailView: renders formatted token count", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, 902900, { cost: null, partial: false });
  assertEquals(out.includes("Tokens   902.9k"), true);
});

Deno.test("formatDetailView: renders em-dash when cost is null", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertEquals(out.includes("Cost     —"), true);
});

Deno.test("formatDetailView: renders $X.XX for full cost", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, null, { cost: 1.23, partial: false });
  assertEquals(out.includes("Cost     $1.23"), true);
});

Deno.test("formatDetailView: renders ~$X.XX for partial cost", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, null, { cost: 1.23, partial: true });
  assertEquals(out.includes("Cost     ~$1.23"), true);
});

Deno.test("formatDetailView: renders em-dash when prs is absent", () => {
  const ticket = makeTicket({ prs: undefined });
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertEquals(out.includes("PRs      —"), true);
});

Deno.test("formatDetailView: renders em-dash when prs is empty", () => {
  const ticket = makeTicket({ prs: [] });
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertEquals(out.includes("PRs      —"), true);
});

Deno.test("formatDetailView: renders single PR url on PRs line", () => {
  const ticket = makeTicket({
    prs: [{
      url: "https://github.com/a/b/pull/1",
      title: "t",
      dependsOn: [],
      merged: false,
    }],
  });
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertEquals(
    out.includes("PRs      https://github.com/a/b/pull/1"),
    true,
  );
});

Deno.test(
  "formatDetailView: renders additional PR urls indented 9 spaces",
  () => {
    const ticket = makeTicket({
      prs: [
        {
          url: "https://github.com/a/b/pull/1",
          title: "t1",
          dependsOn: [],
          merged: false,
        },
        {
          url: "https://github.com/a/b/pull/2",
          title: "t2",
          dependsOn: [],
          merged: false,
        },
      ],
    });
    const out = formatDetailView(ticket, null, { cost: null, partial: false });
    assertEquals(
      out.includes(
        "PRs      https://github.com/a/b/pull/1\n         https://github.com/a/b/pull/2",
      ),
      true,
    );
  },
);

// ── status.completesWith ──────────────────────────────────────────────────────

Deno.test("status command has completesWith set to _ids", () => {
  assertEquals(status.completesWith, "_ids");
});
