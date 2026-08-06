import {
  assert,
  assertEquals,
  assertFalse,
  assertGreater,
  assertLess,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { STATUS_SEQUENCE } from "../state/types.ts";
import type { TicketState, TicketStatus } from "../state/types.ts";
import {
  compareTickets,
  formatDetailView,
  formatStatusHeader,
  formatStatusRow,
  formatTokens,
  readAttentionReason,
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
    artifact: "pr",
    ...overrides,
  };
}

// ── compareTickets ────────────────────────────────────────────────────────────

Deno.test("compareTickets: orders by status index within same phase", () => {
  const a = makeTicket({ phase: "spec", status: "new" });
  const b = makeTicket({ phase: "spec", status: "waiting" });
  assertLess(compareTickets(a, b), 0);
  assertGreater(compareTickets(b, a), 0);
});

Deno.test("compareTickets: phase difference overrides status", () => {
  const a = makeTicket({ phase: "intake", status: "needs-attention" });
  const b = makeTicket({ phase: "spec", status: "new" });
  assertLess(compareTickets(a, b), 0);
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
  assertLess(compareTickets(a, b), 0);
});

Deno.test("compareTickets: unknown status sorts last within phase", () => {
  const a = makeTicket({ phase: "intake", status: "done" as TicketStatus });
  const b = makeTicket({
    phase: "intake",
    status: "unrecognized" as TicketStatus,
  });
  assertLess(compareTickets(a, b), 0);
});

// ── STATUS_SEQUENCE ───────────────────────────────────────────────────────────

Deno.test("STATUS_SEQUENCE is exported and ordered correctly", () => {
  assertEquals(STATUS_SEQUENCE[0], "new");
  assertEquals(STATUS_SEQUENCE[STATUS_SEQUENCE.length - 1], "done");
  assertLess(
    STATUS_SEQUENCE.indexOf("running"),
    STATUS_SEQUENCE.indexOf("waiting"),
  );
  assertLess(
    STATUS_SEQUENCE.indexOf("waiting"),
    STATUS_SEQUENCE.indexOf("revising"),
  );
  assertLess(
    STATUS_SEQUENCE.indexOf("revising"),
    STATUS_SEQUENCE.indexOf("needs-attention"),
  );
  assertLess(
    STATUS_SEQUENCE.indexOf("needs-attention"),
    STATUS_SEQUENCE.indexOf("done"),
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
  assert(row.startsWith("github/jackjennings/lazyboy/23      "));
});

Deno.test("formatStatusHeader: separator line is a full-width rule", () => {
  const lines = formatStatusHeader().split("\n");
  assertGreater(lines[1].length, 0);
  assertMatch(lines[1], /^─+$/);
});

// ── shouldHideTicket ──────────────────────────────────────────────────────────

Deno.test("shouldHideTicket: returns true for merge/done", () => {
  assert(shouldHideTicket("merge", "done"));
});

Deno.test("shouldHideTicket: returns true for wont-do (any status)", () => {
  assert(shouldHideTicket("wont-do", "done"));
});

Deno.test("shouldHideTicket: returns false for merge/running", () => {
  assertFalse(shouldHideTicket("merge", "running"));
});

Deno.test("shouldHideTicket: returns false for active phases", () => {
  assertFalse(shouldHideTicket("intake", "running"));
  assertFalse(shouldHideTicket("implementation", "waiting"));
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
  assert(out.startsWith("Phase    spec\nStatus   running\n"));
});

Deno.test("formatDetailView: renders em-dash for null tokens", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertStringIncludes(out, "Tokens   —");
});

Deno.test("formatDetailView: renders formatted token count", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, 902900, { cost: null, partial: false });
  assertStringIncludes(out, "Tokens   902.9k");
});

Deno.test("formatDetailView: renders em-dash when cost is null", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertStringIncludes(out, "Cost     —");
});

Deno.test("formatDetailView: renders $X.XX for full cost", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, null, { cost: 1.23, partial: false });
  assertStringIncludes(out, "Cost     $1.23");
});

Deno.test("formatDetailView: renders ~$X.XX for partial cost", () => {
  const ticket = makeTicket({});
  const out = formatDetailView(ticket, null, { cost: 1.23, partial: true });
  assertStringIncludes(out, "Cost     ~$1.23");
});

Deno.test("formatDetailView: renders em-dash when prs is absent", () => {
  const ticket = makeTicket({ prs: undefined });
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertStringIncludes(out, "PRs      —");
});

Deno.test("formatDetailView: renders em-dash when prs is empty", () => {
  const ticket = makeTicket({ prs: [] });
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertStringIncludes(out, "PRs      —");
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
  assertStringIncludes(out, "PRs      https://github.com/a/b/pull/1");
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
    assertStringIncludes(
      out,
      "PRs      https://github.com/a/b/pull/1\n         https://github.com/a/b/pull/2",
    );
  },
);

Deno.test(
  "formatStatusRow: renders shortTitle when ticket has one",
  () => {
    const ticket = makeTicket({
      title: "A very long full title for the issue",
      shortTitle: "Short label",
    });
    const row = formatStatusRow(
      ticket.id,
      ticket.phase,
      ticket.status,
      ticket.approvals,
      "0",
      ticket.shortTitle ?? ticket.title,
    );
    assertStringIncludes(row, "Short label");
    assertFalse(row.includes("A very long full title for the issue"));
  },
);

Deno.test(
  "formatStatusRow: falls back to title when shortTitle is absent",
  () => {
    const ticket = makeTicket({ title: "Full title only" });
    const row = formatStatusRow(
      ticket.id,
      ticket.phase,
      ticket.status,
      ticket.approvals,
      "0",
      ticket.shortTitle ?? ticket.title,
    );
    assertStringIncludes(row, "Full title only");
  },
);

// ── status.completesWith ──────────────────────────────────────────────────────

Deno.test("status command has completesWith set to _ids", () => {
  assertEquals(status.completesWith, "_ids");
});

// ── readAttentionReason ───────────────────────────────────────────────────────

Deno.test("readAttentionReason: returns null when log file is missing", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    assertEquals(await readAttentionReason(tempDir), null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: returns null when log has no matching events", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      JSON.stringify({
        ts: "2026-07-30T10:00:00Z",
        event: "phase-start",
        phase: "intake",
      }) + "\n",
    );
    assertEquals(await readAttentionReason(tempDir), null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: returns last matching entry when multiple exist", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      [
        JSON.stringify({
          ts: "2026-07-30T10:00:00Z",
          event: "needs-attention",
          reason: "clone-failed",
        }),
        JSON.stringify({
          ts: "2026-07-30T11:00:00Z",
          event: "phase-start",
          phase: "intake",
        }),
        JSON.stringify({
          ts: "2026-07-30T12:00:00Z",
          event: "needs-attention",
          reason: "worktree-creation-failed",
        }),
      ].join("\n") + "\n",
    );
    assertEquals(
      await readAttentionReason(tempDir),
      "2026-07-30T12:00:00Z: needs-attention: reason=worktree-creation-failed",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: formats phase-output-invalid with phase and reason", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      JSON.stringify({
        ts: "2026-07-30T16:41:11Z",
        event: "phase-output-invalid",
        phase: "intake",
        reason: "missing",
      }) + "\n",
    );
    assertEquals(
      await readAttentionReason(tempDir),
      "2026-07-30T16:41:11Z: phase-output-invalid: phase=intake, reason=missing",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: formats phase-transition to needs-attention with reason", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      JSON.stringify({
        ts: "2026-07-31T18:06:28Z",
        event: "phase-transition",
        from: "intake",
        to: "needs-attention",
        reason: "no-worktrees",
      }) + "\n",
    );
    assertEquals(
      await readAttentionReason(tempDir),
      "2026-07-31T18:06:28Z: phase-transition: reason=no-worktrees",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: ignores phase-transition not targeting needs-attention", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      JSON.stringify({
        ts: "2026-07-31T18:06:28Z",
        event: "phase-transition",
        from: "intake",
        to: "running",
        reason: "retry",
      }) + "\n",
    );
    assertEquals(await readAttentionReason(tempDir), null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: formats needs-attention event with reason", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      JSON.stringify({
        ts: "2026-07-31T18:06:28Z",
        event: "needs-attention",
        reason: "clone-failed",
      }) + "\n",
    );
    assertEquals(
      await readAttentionReason(tempDir),
      "2026-07-31T18:06:28Z: needs-attention: reason=clone-failed",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: formats conflict-resolution-failed with reason and branch, omits worktreePath", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      JSON.stringify({
        ts: "2026-07-31T19:45:22Z",
        event: "conflict-resolution-failed",
        reason: "agent-failed",
        branch: "github/jackjennings/lazyboy/271",
        worktreePath: "/some/long/path",
      }) + "\n",
    );
    assertEquals(
      await readAttentionReason(tempDir),
      "2026-07-31T19:45:22Z: conflict-resolution-failed: reason=agent-failed, branch=github/jackjennings/lazyboy/271",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: formats error/resolveCITriage with reason and runId", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      JSON.stringify({
        ts: "2026-07-31T20:00:00Z",
        event: "error",
        context: "resolveCITriage",
        reason: "output-file-missing",
        runId: "wf_abc123",
      }) + "\n",
    );
    assertEquals(
      await readAttentionReason(tempDir),
      "2026-07-31T20:00:00Z: error: reason=output-file-missing, runId=wf_abc123",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: ignores error events without resolveCITriage context", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      JSON.stringify({
        ts: "2026-07-31T20:00:00Z",
        event: "error",
        context: "other",
        reason: "something",
      }) + "\n",
    );
    assertEquals(await readAttentionReason(tempDir), null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readAttentionReason: skips malformed JSON lines and continues scanning", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "log.ndjson"),
      [
        "not-valid-json",
        JSON.stringify({
          ts: "2026-07-31T18:06:28Z",
          event: "needs-attention",
          reason: "clone-failed",
        }),
      ].join("\n") + "\n",
    );
    assertEquals(
      await readAttentionReason(tempDir),
      "2026-07-31T18:06:28Z: needs-attention: reason=clone-failed",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ── formatDetailView (Reason line) ────────────────────────────────────────────

Deno.test("formatDetailView: appends Reason line when attentionReason is provided", () => {
  const ticket = makeTicket({ status: "needs-attention" });
  const out = formatDetailView(
    ticket,
    null,
    { cost: null, partial: false },
    "2026-07-30T16:41:11Z: needs-attention: reason=clone-failed",
  );
  assertStringIncludes(
    out,
    "Reason   2026-07-30T16:41:11Z: needs-attention: reason=clone-failed",
  );
});

Deno.test("formatDetailView: omits Reason line when attentionReason is null", () => {
  const ticket = makeTicket({ status: "needs-attention" });
  const out = formatDetailView(
    ticket,
    null,
    { cost: null, partial: false },
    null,
  );
  assertFalse(out.includes("Reason"));
});

Deno.test("formatDetailView: omits Reason line when attentionReason is not passed", () => {
  const ticket = makeTicket({ status: "needs-attention" });
  const out = formatDetailView(ticket, null, { cost: null, partial: false });
  assertFalse(out.includes("Reason"));
});

Deno.test("formatDetailView: Reason is the last line", () => {
  const ticket = makeTicket({ status: "needs-attention" });
  const out = formatDetailView(
    ticket,
    null,
    { cost: null, partial: false },
    "2026-07-30T16:41:11Z: needs-attention: reason=clone-failed",
  );
  const lines = out.split("\n");
  assert(lines[lines.length - 1].startsWith("Reason"));
});
