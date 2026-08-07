import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertFalse,
  assertLess,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { dirname, join } from "@std/path";
import {
  appendPhaseLog,
  buildContextFiles,
  dedupePrinciples,
  executePhase,
  extractClaudeCodeSessionId,
  extractClaudeCodeUsageAndText,
  extractPrinciples,
  extractSessionId,
  extractUsageAndText,
  getPiEnvironmentVariables,
  judgePrinciples,
  setupClaudeCodeDirectories,
  setupPiDirectories,
} from "./run-phase.ts";
import type { CommandRunner } from "./apfel.ts";
import type { CodeAgent } from "./agents/types.ts";
import type { AnthropicPricingCache } from "./anthropic-pricing.ts";

// ── getPiEnvironmentVariables ────────────────────────────────────────────────

Deno.test("getPiEnvironmentVariables: returns pi directory variables with expanded HOME", () => {
  const home = "/home/testuser";
  const result = getPiEnvironmentVariables(home);

  assertEquals(result.PI_CODING_AGENT_DIR, "/home/testuser/.lazyboy/pi");
  assertEquals(
    result.PI_CODING_AGENT_SESSION_DIR,
    "/home/testuser/.lazyboy/pi/sessions",
  );
});

Deno.test("getPiEnvironmentVariables: constructs paths correctly with different HOME values", () => {
  const home = "/Users/jack";
  const result = getPiEnvironmentVariables(home);

  assertEquals(result.PI_CODING_AGENT_DIR, "/Users/jack/.lazyboy/pi");
  assertEquals(
    result.PI_CODING_AGENT_SESSION_DIR,
    "/Users/jack/.lazyboy/pi/sessions",
  );
});

// ── setupPiDirectories ───────────────────────────────────────────────────────

Deno.test("setupPiDirectories: creates pi directories in temp home", async () => {
  const tempHome = await Deno.makeTempDir();

  try {
    await setupPiDirectories(tempHome);

    // Verify both directories were created
    const piDir = await Deno.stat(join(tempHome, ".lazyboy", "pi"));
    const sessionsDir = await Deno.stat(
      join(tempHome, ".lazyboy", "pi", "sessions"),
    );

    assert(piDir.isDirectory);
    assert(sessionsDir.isDirectory);
  } finally {
    await Deno.remove(tempHome, { recursive: true });
  }
});

Deno.test("setupPiDirectories: succeeds when directories already exist", async () => {
  const tempHome = await Deno.makeTempDir();

  try {
    // Create directories first time
    await setupPiDirectories(tempHome);

    // Call again - should not throw
    await setupPiDirectories(tempHome);

    const piDir = await Deno.stat(join(tempHome, ".lazyboy", "pi"));
    assert(piDir.isDirectory);
  } finally {
    await Deno.remove(tempHome, { recursive: true });
  }
});

// ── setupClaudeCodeDirectories ───────────────────────────────────────────────

Deno.test("setupClaudeCodeDirectories: creates claude-code directory in temp home", async () => {
  const tempHome = await Deno.makeTempDir();
  try {
    await setupClaudeCodeDirectories(tempHome);
    const dir = await Deno.stat(join(tempHome, ".lazyboy", "claude-code"));
    assert(dir.isDirectory);
  } finally {
    await Deno.remove(tempHome, { recursive: true });
  }
});

Deno.test("setupClaudeCodeDirectories: writes default settings.json when absent", async () => {
  const tempHome = await Deno.makeTempDir();
  try {
    await setupClaudeCodeDirectories(tempHome);
    const raw = await Deno.readTextFile(
      join(tempHome, ".lazyboy", "claude-code", "settings.json"),
    );
    const settings = JSON.parse(raw);
    assertEquals(settings.attribution.commit, "");
    assertEquals(settings.attribution.pr, "");
  } finally {
    await Deno.remove(tempHome, { recursive: true });
  }
});

Deno.test("setupClaudeCodeDirectories: does not overwrite existing settings.json", async () => {
  const tempHome = await Deno.makeTempDir();
  try {
    const dir = join(tempHome, ".lazyboy", "claude-code");
    await Deno.mkdir(dir, { recursive: true });
    const settingsPath = join(dir, "settings.json");
    await Deno.writeTextFile(settingsPath, '{"custom":true}');
    await setupClaudeCodeDirectories(tempHome);
    const raw = await Deno.readTextFile(settingsPath);
    assertEquals(JSON.parse(raw).custom, true);
  } finally {
    await Deno.remove(tempHome, { recursive: true });
  }
});

Deno.test("setupClaudeCodeDirectories: succeeds when directory already exists", async () => {
  const tempHome = await Deno.makeTempDir();
  try {
    await setupClaudeCodeDirectories(tempHome);
    await setupClaudeCodeDirectories(tempHome);
    const dir = await Deno.stat(join(tempHome, ".lazyboy", "claude-code"));
    assert(dir.isDirectory);
  } finally {
    await Deno.remove(tempHome, { recursive: true });
  }
});

// ── buildContextFiles ────────────────────────────────────────────────────────

Deno.test("buildContextFiles: always includes meta.md", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    const files = await buildContextFiles({
      ticketDir: tempDir,
      stateDir: dirname(tempDir),
    });
    assertEquals(files[0], `@${tempDir}/meta.md`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: includes prefix-timestamped phase output files", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260629T154506-intake.md"),
      "intake",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T154506-spec.md"),
      "spec",
    );
    const files = await buildContextFiles({
      ticketDir: tempDir,
      stateDir: dirname(tempDir),
    });
    assertArrayIncludes(files, [`@${tempDir}/20260629T154506-intake.md`]);
    assertArrayIncludes(files, [`@${tempDir}/20260629T154506-spec.md`]);
    assertFalse(files.includes(`@${tempDir}/20260629T154506-enrichment.md`));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: includes prefixed output and feedback files in chronological order", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260629T154506-intake.md"),
      "output",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T160000-intake-feedback.md"),
      "feedback",
    );
    const files = await buildContextFiles({
      ticketDir: tempDir,
      stateDir: dirname(tempDir),
    });
    const outIdx = files.indexOf(`@${tempDir}/20260629T154506-intake.md`);
    const fbIdx = files.indexOf(
      `@${tempDir}/20260629T160000-intake-feedback.md`,
    );
    assertNotEquals(outIdx, -1);
    assertNotEquals(fbIdx, -1);
    assertLess(outIdx, fbIdx);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: does not include files for phases not in context list", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260629T154506-diff.md"),
      "diff",
    );
    const files = await buildContextFiles({
      ticketDir: tempDir,
      stateDir: dirname(tempDir),
    });
    assertFalse(files.includes(`@${tempDir}/20260629T154506-diff.md`));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: includes implementation output files", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260630T100000-implementation.md"),
      "output",
    );
    const files = await buildContextFiles({
      ticketDir: tempDir,
      stateDir: dirname(tempDir),
    });
    assertArrayIncludes(files, [
      `@${tempDir}/20260630T100000-implementation.md`,
    ]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: includes implementation feedback files after implementation output", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260630T100000-implementation.md"),
      "output",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260630T120000-implementation-feedback.md"),
      "feedback",
    );
    const files = await buildContextFiles({
      ticketDir: tempDir,
      stateDir: dirname(tempDir),
    });
    const outIdx = files.indexOf(
      `@${tempDir}/20260630T100000-implementation.md`,
    );
    const fbIdx = files.indexOf(
      `@${tempDir}/20260630T120000-implementation-feedback.md`,
    );
    assertNotEquals(outIdx, -1);
    assertNotEquals(fbIdx, -1);
    assertLess(outIdx, fbIdx);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: implementation files appear after plan files", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260629T090000-plan.md"),
      "plan output",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260630T100000-implementation.md"),
      "implementation output",
    );
    const files = await buildContextFiles({
      ticketDir: tempDir,
      stateDir: dirname(tempDir),
    });
    const planIdx = files.indexOf(`@${tempDir}/20260629T090000-plan.md`);
    const implIdx = files.indexOf(
      `@${tempDir}/20260630T100000-implementation.md`,
    );
    assertNotEquals(planIdx, -1);
    assertNotEquals(implIdx, -1);
    assertLess(planIdx, implIdx);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: prunes superseded drafts, keeping only the latest doc and feedback per phase", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260629T090000-spec.md"),
      "draft 1",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T091000-spec-feedback.md"),
      "feedback 1",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T092000-spec.md"),
      "draft 2",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T093000-spec-feedback.md"),
      "feedback 2",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T094000-spec.md"),
      "draft 3",
    );

    const files = await buildContextFiles({
      ticketDir: tempDir,
      stateDir: dirname(tempDir),
    });

    assertFalse(files.includes(`@${tempDir}/20260629T090000-spec.md`));
    assertFalse(files.includes(`@${tempDir}/20260629T091000-spec-feedback.md`));
    assertFalse(files.includes(`@${tempDir}/20260629T092000-spec.md`));
    assertFalse(files.includes(`@${tempDir}/20260629T093000-spec-feedback.md`));
    assertArrayIncludes(files, [`@${tempDir}/20260629T094000-spec.md`]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: keeps latest doc and pending feedback when a revision is awaiting rework", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(tempDir, "20260629T090000-plan.md"),
      "draft 1",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T091000-plan-feedback.md"),
      "feedback 1",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T092000-plan.md"),
      "draft 2",
    );
    await Deno.writeTextFile(
      join(tempDir, "20260629T093000-plan-feedback.md"),
      "feedback 2 (latest, revision pending)",
    );

    const files = await buildContextFiles({
      ticketDir: tempDir,
      stateDir: dirname(tempDir),
    });

    assertFalse(files.includes(`@${tempDir}/20260629T090000-plan.md`));
    assertFalse(files.includes(`@${tempDir}/20260629T091000-plan-feedback.md`));
    assertArrayIncludes(files, [`@${tempDir}/20260629T092000-plan.md`]);
    assertArrayIncludes(files, [
      `@${tempDir}/20260629T093000-plan-feedback.md`,
    ]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: prepends principles.md when it exists in stateDir", async () => {
  const stateDir = await Deno.makeTempDir();
  const ticketDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(join(stateDir, "principles.md"), "- learn A");
    const files = await buildContextFiles({ ticketDir, stateDir });
    assertEquals(files[0], `@${stateDir}/principles.md`);
    assertEquals(files[1], `@${ticketDir}/meta.md`);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(ticketDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: omits principles.md when includePrinciples is false", async () => {
  const stateDir = await Deno.makeTempDir();
  const ticketDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(join(stateDir, "principles.md"), "- learn A");
    const files = await buildContextFiles({
      ticketDir,
      stateDir,
      includePrinciples: false,
    });
    assertEquals(files[0], `@${ticketDir}/meta.md`);
    assertFalse(files.some((f) => f.includes("principles.md")));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(ticketDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: omits principles.md when it does not exist in stateDir", async () => {
  const stateDir = await Deno.makeTempDir();
  const ticketDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    const files = await buildContextFiles({ ticketDir, stateDir });
    assertEquals(files[0], `@${ticketDir}/meta.md`);
    assertFalse(files.some((f) => f.includes("principles.md")));
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(ticketDir, { recursive: true });
  }
});

// ── extractPrinciples ────────────────────────────────────────────────────────

Deno.test("extractPrinciples: returns body of ## Principles section", () => {
  const output =
    `## What to Build\n\nsome content\n\n## Principles\n\n- learn A\n- learn B\n\n## Next Steps\n\nmore stuff`;
  assertEquals(extractPrinciples(output), "- learn A\n- learn B");
});

Deno.test("extractPrinciples: returns null when section is absent", () => {
  const output = `## What to Build\n\nsome content`;
  assertEquals(extractPrinciples(output), null);
});

Deno.test("extractPrinciples: returns null when section is empty", () => {
  const output = `## What to Build\n\nsome\n\n## Principles\n\n## Next Steps`;
  assertEquals(extractPrinciples(output), null);
});

Deno.test("extractPrinciples: captures content to end of string when no following heading", () => {
  const output = `## Principles\n\n- only learning`;
  assertEquals(extractPrinciples(output), "- only learning");
});

Deno.test("extractPrinciples: trims surrounding whitespace", () => {
  const output = `## Principles\n\n\n  trimmed  \n\n`;
  assertEquals(extractPrinciples(output), "trimmed");
});

// ── judgePrinciples ───────────────────────────────────────────────────────────

Deno.test("judgePrinciples: calls claude CLI when apfel exits non-zero, returns true on KEEP", async () => {
  const run: CommandRunner = spy((args: string[]) =>
    Promise.resolve(
      args[0] === "apfel"
        ? { code: 1, stdout: "" }
        : { code: 0, stdout: "KEEP" },
    )
  );
  assert(await judgePrinciples("- prefer X over Y", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 2);
});

Deno.test("judgePrinciples: returns false when claude CLI exits non-zero", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 1, stdout: "" })
  );
  assertFalse(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: returns false when claude CLI throws", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.reject(new Error("not found"))
  );
  assertFalse(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: passes body as second arg to claude CLI", async () => {
  const run: CommandRunner = spy((args: string[]) =>
    Promise.resolve(
      args[0] === "apfel"
        ? { code: 1, stdout: "" }
        : { code: 0, stdout: "KEEP" },
    )
  );
  await judgePrinciples("- prefer X over Y", run);
  const args = (run as ReturnType<typeof spy>).calls[1].args[0] as string[];
  assertEquals(args[0], "claude");
  assertEquals(args[1], "- prefer X over Y");
});

Deno.test("judgePrinciples: passes --model claude-haiku-4-5 to claude CLI", async () => {
  const run: CommandRunner = spy((args: string[]) =>
    Promise.resolve(
      args[0] === "apfel"
        ? { code: 1, stdout: "" }
        : { code: 0, stdout: "KEEP" },
    )
  );
  await judgePrinciples("- prefer X over Y", run);
  const args = (run as ReturnType<typeof spy>).calls[1].args[0] as string[];
  const modelIdx = args.indexOf("--model");
  assertNotEquals(modelIdx, -1);
  assertEquals(args[modelIdx + 1], "claude-haiku-4-5");
});

Deno.test("judgePrinciples: returns true when claude CLI returns KEEP followed by whitespace", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "KEEP\n" })
  );
  assert(await judgePrinciples("- prefer X over Y", run));
});

Deno.test("judgePrinciples: returns false when claude CLI returns SKIP", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "SKIP" })
  );
  assertFalse(await judgePrinciples("_(nothing meets bar)_", run));
});

Deno.test("judgePrinciples: uses apfel first, returns true on KEEP without calling claude", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "KEEP" })
  );
  assert(await judgePrinciples("- prefer X over Y", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 1);
  const firstCall = (run as ReturnType<typeof spy>).calls[0]
    .args[0] as string[];
  assertEquals(firstCall[0], "apfel");
});

Deno.test("judgePrinciples: uses apfel first, returns false on SKIP without calling claude", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "SKIP" })
  );
  assertFalse(await judgePrinciples("_(nothing)_", run));
  assertSpyCalls(run as ReturnType<typeof spy>, 1);
});

Deno.test("judgePrinciples: passes body as last arg to apfel", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "KEEP" })
  );
  await judgePrinciples("- prefer X over Y", run);
  const args = (run as ReturnType<typeof spy>).calls[0].args[0] as string[];
  assertEquals(args[args.length - 1], "- prefer X over Y");
});

Deno.test("judgePrinciples: apfel KEEP followed by whitespace returns true", async () => {
  const run: CommandRunner = spy((_args: string[]) =>
    Promise.resolve({ code: 0, stdout: "KEEP " })
  );
  assert(await judgePrinciples("- prefer X over Y", run));
});

// ── dedupePrinciples ─────────────────────────────────────────────────────────

Deno.test("dedupePrinciples: appends a genuinely new bullet", () => {
  const existing = "- learn A";
  const extracted = "- learn B";
  assertEquals(dedupePrinciples(existing, extracted), "- learn B");
});

Deno.test("dedupePrinciples: is a no-op when the bullet is already present", () => {
  const existing = "- learn A\n\n- learn B";
  assertEquals(dedupePrinciples(existing, "- learn B"), null);
});

Deno.test("dedupePrinciples: keeps only the novel bullets from a mixed block", () => {
  const existing = "- learn A";
  const extracted = "- learn A\n- learn B";
  assertEquals(dedupePrinciples(existing, extracted), "- learn B");
});

Deno.test("dedupePrinciples: normalizes whitespace when comparing", () => {
  const existing = "- learn A with   spaces";
  const extracted = "- learn A with spaces";
  assertEquals(dedupePrinciples(existing, extracted), null);
});

Deno.test("dedupePrinciples: matches a multi-line bullet against its wrapped duplicate", () => {
  const existing = "- a long principle that\n  wraps across two lines";
  const extracted = "- a long principle that wraps across two lines";
  assertEquals(dedupePrinciples(existing, extracted), null);
});

Deno.test("dedupePrinciples: dedupes within the extracted block itself", () => {
  assertEquals(dedupePrinciples("", "- learn A\n- learn A"), "- learn A");
});

Deno.test("dedupePrinciples: returns the block unchanged when existing is empty", () => {
  const extracted = "- learn A\n- learn B";
  assertEquals(dedupePrinciples("", extracted), extracted);
});

// ── appendPhaseLog ───────────────────────────────────────────────────────────

Deno.test("appendPhaseLog: creates log.ndjson and writes a valid JSON line", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await appendPhaseLog(tempDir, { event: "phase-start", phase: "intake" });

    const content = await Deno.readTextFile(`${tempDir}/log.ndjson`);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assertEquals(entry.event, "phase-start");
    assertEquals(entry.phase, "intake");
    assertEquals(typeof entry.ts, "string");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("appendPhaseLog: appends to existing log.ndjson", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await appendPhaseLog(tempDir, { event: "phase-start", phase: "spec" });
    await appendPhaseLog(tempDir, {
      event: "phase-end",
      phase: "spec",
      exitCode: 0,
      output: "",
    });

    const content = await Deno.readTextFile(`${tempDir}/log.ndjson`);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 2);
    assertEquals(JSON.parse(lines[0]).event, "phase-start");
    assertEquals(JSON.parse(lines[1]).event, "phase-end");
    assertEquals(JSON.parse(lines[1]).exitCode, 0);
    assertEquals(JSON.parse(lines[1]).output, "");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("appendPhaseLog: propagates error when directory does not exist", async () => {
  await assertRejects(() =>
    appendPhaseLog("/nonexistent/ticket/dir", {
      event: "phase-start",
      phase: "intake",
    })
  );
});

// ── executePhase ─────────────────────────────────────────────────────────────

Deno.test("executePhase: forwards buildContextFiles result to agent.runPhase", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(
      join(ticketDir, "20260101T000000-intake.md"),
      "intake",
    );

    let capturedContextFiles: string[] = [];
    const agent: CodeAgent = {
      runPhase(opts) {
        capturedContextFiles = opts.contextFiles;
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      },
    };

    await executePhase(
      {
        ticketDir,
        stateDir: dirname(ticketDir),
        outputFile: "out.md",
        phase: "intake",
        scopeDirs: [],
        prompt: "do the thing",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );

    assertArrayIncludes(capturedContextFiles, [`@${ticketDir}/meta.md`]);
    assertArrayIncludes(capturedContextFiles, [
      `@${ticketDir}/20260101T000000-intake.md`,
    ]);
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: prompt includes base prompt, ticketDir, scopeDirs, and worktree paths", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

    let capturedPrompt = "";
    const agent: CodeAgent = {
      runPhase(opts) {
        capturedPrompt = opts.prompt;
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      },
    };

    await executePhase(
      {
        ticketDir,
        stateDir: dirname(ticketDir),
        outputFile: "out.md",
        phase: "intake",
        scopeDirs: ["/some/scope"],
        prompt: "base prompt",
        worktrees: { repo: { path: "/some/worktree", branch: "main" } },
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );

    assert(capturedPrompt.startsWith("base prompt"));
    assertStringIncludes(capturedPrompt, ticketDir);
    assertStringIncludes(capturedPrompt, "/some/scope");
    assertStringIncludes(capturedPrompt, "/some/worktree");
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: passes provider, model, and thinking to agent.runPhase", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

    let capturedProvider = "";
    let capturedModel = "";
    let capturedThinking = "";
    const agent: CodeAgent = {
      runPhase(opts) {
        capturedProvider = opts.provider;
        capturedModel = opts.model;
        capturedThinking = opts.thinking;
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      },
    };

    await executePhase(
      {
        ticketDir,
        stateDir: dirname(ticketDir),
        outputFile: "out.md",
        phase: "intake",
        scopeDirs: [],
        prompt: "prompt",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        thinking: "minimal",
        agentType: "pi",
      },
      agent,
    );

    assertEquals(capturedProvider, "anthropic");
    assertEquals(capturedModel, "claude-haiku-4-5");
    assertEquals(capturedThinking, "minimal");
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: forwards a non-default provider (bedrock) to agent.runPhase", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

    let capturedProvider = "";
    const agent: CodeAgent = {
      runPhase(opts) {
        capturedProvider = opts.provider;
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      },
    };

    await executePhase(
      {
        ticketDir,
        stateDir: dirname(ticketDir),
        outputFile: "out.md",
        phase: "intake",
        scopeDirs: [],
        prompt: "prompt",
        worktrees: {},
        homeDir,
        provider: "bedrock",
        model: "anthropic.claude-opus-4-8",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );

    assertEquals(capturedProvider, "bedrock");
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test(
  "executePhase: includes output file path in prompt context",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
      let capturedPrompt = "";
      const agent: CodeAgent = {
        runPhase(opts) {
          capturedPrompt = opts.prompt;
          return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        },
      };
      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "20260727T000000-spec.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "prompt",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );
      assertStringIncludes(
        capturedPrompt,
        join(ticketDir, "20260727T000000-spec.md"),
      );
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: deletes pre-existing output file before launching agent",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
      await Deno.writeTextFile(join(ticketDir, "result.md"), "stale content");
      const agent: CodeAgent = {
        runPhase() {
          return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        },
      };
      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "result.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "prompt",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );
      await assertRejects(
        () => Deno.readTextFile(join(ticketDir, "result.md")),
        Deno.errors.NotFound,
      );
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: reads output file from disk; does not overwrite agent-written content",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
      const outputPath = join(ticketDir, "result.md");
      const agent: CodeAgent = {
        async runPhase() {
          await Deno.writeTextFile(outputPath, "## Section\n\nAgent content.");
          return Promise.resolve({ stdout: "", stderr: "", code: 7 });
        },
      };
      const exitCode = await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "result.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "prompt",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );
      assertEquals(exitCode, 7);
      const content = await Deno.readTextFile(outputPath);
      assertEquals(content, "## Section\n\nAgent content.");
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: still writes usage sidecar and logs phase-end when agent writes output file",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
      const outputPath = join(ticketDir, "result.md");
      const agentEndNdjson = JSON.stringify({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "agent output" }],
            usage: {
              input: 5,
              output: 3,
              cacheRead: 10,
              cacheWrite: 2,
              totalTokens: 20,
              cacheWrite1h: 0,
              reasoning: 0,
              cost: {},
            },
          },
        ],
      });
      const agent: CodeAgent = {
        async runPhase() {
          await Deno.writeTextFile(
            outputPath,
            "## Output\n\nWritten by agent.",
          );
          return Promise.resolve({
            stdout: agentEndNdjson,
            stderr: "agent errors",
            code: 42,
          });
        },
      };
      const exitCode = await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "result.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "prompt",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );
      assertEquals(exitCode, 42);
      const usageRaw = await Deno.readTextFile(
        join(ticketDir, "result.usage.json"),
      );
      const usage = JSON.parse(usageRaw);
      assertEquals(usage.input, 5);
      assertEquals(usage.output, 3);
      assertEquals(usage.model, "claude-sonnet-4-6");
      const logContent = await Deno.readTextFile(join(ticketDir, "log.ndjson"));
      const logLines = logContent.trim().split("\n");
      const endEntry = JSON.parse(logLines[logLines.length - 1]);
      assertEquals(endEntry.event, "phase-end");
      assertEquals(endEntry.exitCode, 42);
      assertEquals(endEntry.output, "agent errors");
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test("executePhase: writes .exit sidecar with exit code before returning", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    const outputFile = "20260101T120000-intake.md";
    const agent: CodeAgent = {
      runPhase: () => Promise.resolve({ stdout: "", stderr: "", code: 2 }),
    };
    await executePhase(
      {
        ticketDir,
        stateDir: ticketDir,
        outputFile,
        phase: "intake",
        scopeDirs: [],
        prompt: "p",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );
    const sidecar = await Deno.readTextFile(
      join(ticketDir, outputFile + ".exit"),
    );
    assertEquals(sidecar, "2");
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: .exit sidecar write failure does not suppress returned exit code", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  const outputFile = "20260101T120000-intake.md";
  const sidecarPath = join(ticketDir, outputFile + ".exit");
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    // pre-create the sidecar as read-only so the write inside executePhase fails
    await Deno.writeTextFile(sidecarPath, "old");
    await Deno.chmod(sidecarPath, 0o444);
    const agent: CodeAgent = {
      runPhase: () => Promise.resolve({ stdout: "", stderr: "", code: 1 }),
    };
    const returnedCode = await executePhase(
      {
        ticketDir,
        stateDir: ticketDir,
        outputFile,
        phase: "intake",
        scopeDirs: [],
        prompt: "p",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );
    assertEquals(returnedCode, 1);
  } finally {
    await Deno.chmod(sidecarPath, 0o644).catch(() => {});
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: writes .session sidecar with session ID when present", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    const outputFile = "20260101T120000-intake.md";
    const sessionLine = JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-abc",
    });
    const agent: CodeAgent = {
      runPhase: () =>
        Promise.resolve({ stdout: sessionLine, stderr: "", code: 0 }),
    };
    await executePhase(
      {
        ticketDir,
        stateDir: ticketDir,
        outputFile,
        phase: "intake",
        scopeDirs: [],
        prompt: "p",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );
    const sidecar = await Deno.readTextFile(
      join(ticketDir, outputFile + ".session"),
    );
    assertEquals(sidecar, "sess-abc");
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: does not write .session sidecar when no session ID in output", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    const outputFile = "20260101T120000-intake.md";
    const agent: CodeAgent = {
      runPhase: () => Promise.resolve({ stdout: "", stderr: "", code: 0 }),
    };
    await executePhase(
      {
        ticketDir,
        stateDir: ticketDir,
        outputFile,
        phase: "intake",
        scopeDirs: [],
        prompt: "p",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );
    let exists = true;
    try {
      await Deno.stat(join(ticketDir, outputFile + ".session"));
    } catch {
      exists = false;
    }
    assertFalse(exists);
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

// ── extractUsageAndText ──────────────────────────────────────────────────────

const singleTurnNdjson = [
  JSON.stringify({ type: "session", version: 3, id: "test-session-id-single" }),
  JSON.stringify({
    type: "agent_end",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hi" }],
      },
      {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Hello!" }],
        usage: {
          input: 10,
          output: 5,
          cacheRead: 100,
          cacheWrite: 50,
          totalTokens: 165,
          cacheWrite1h: 0,
          reasoning: 0,
          cost: {},
        },
      },
    ],
  }),
].join("\n");

Deno.test(
  "extractUsageAndText: single-turn returns correct text, usage fields, and durationMs",
  () => {
    const result = extractUsageAndText(singleTurnNdjson, 1234);
    assertEquals(result.text, "Hello!");
    assertEquals(result.usage?.input, 10);
    assertEquals(result.usage?.output, 5);
    assertEquals(result.usage?.cacheRead, 100);
    assertEquals(result.usage?.cacheWrite, 50);
    assertEquals(result.usage?.model, "claude-sonnet-4-6");
    assertEquals(result.usage?.durationMs, 1234);
    assertEquals(result.usage?.turns, 1);
  },
);

const multiTurnNdjson = [
  JSON.stringify({ type: "session", version: 3, id: "test-session-id-multi" }),
  JSON.stringify({
    type: "agent_end",
    messages: [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "First." }],
        usage: {
          input: 8,
          output: 3,
          cacheRead: 40,
          cacheWrite: 20,
          totalTokens: 71,
          cacheWrite1h: 0,
          reasoning: 0,
          cost: {},
        },
      },
      { role: "user", content: [{ type: "text", text: "tool result" }] },
      {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Second." }],
        usage: {
          input: 2,
          output: 7,
          cacheRead: 60,
          cacheWrite: 30,
          totalTokens: 99,
          cacheWrite1h: 0,
          reasoning: 0,
          cost: {},
        },
      },
    ],
  }),
].join("\n");

Deno.test(
  "extractUsageAndText: multi-turn sums usage fields and keeps only the final assistant turn's text",
  () => {
    const result = extractUsageAndText(multiTurnNdjson, 500);
    assertEquals(result.text, "Second.");
    assertEquals(result.usage?.input, 10);
    assertEquals(result.usage?.output, 10);
    assertEquals(result.usage?.cacheRead, 100);
    assertEquals(result.usage?.cacheWrite, 50);
    assertEquals(result.usage?.model, "claude-sonnet-4-6");
    assertEquals(result.usage?.durationMs, 500);
    assertEquals(result.usage?.turns, 2);
  },
);

Deno.test(
  "extractUsageAndText: trailing text-only assistant turn after a tool-only turn returns only that final text",
  () => {
    const ndjson = JSON.stringify({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            { type: "text", text: "Let me check the file." },
            { type: "tool_use", name: "read", input: {} },
          ],
        },
        { role: "user", content: [{ type: "tool_result", text: "..." }] },
        {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "## Proposed Scope\n..." }],
        },
      ],
    });
    const result = extractUsageAndText(ndjson, 50);
    assertEquals(result.text, "## Proposed Scope\n...");
  },
);

Deno.test(
  "extractUsageAndText: no agent_end line returns empty text and null usage",
  () => {
    const ndjson = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "test-session-id-none",
      }),
      JSON.stringify({ type: "message_update", delta: "hi" }),
    ].join("\n");
    const result = extractUsageAndText(ndjson, 100);
    assertEquals(result.text, "");
    assertEquals(result.usage, null);
  },
);

Deno.test(
  "extractUsageAndText: assistant content with only thinking items returns empty text and usage",
  () => {
    const ndjson = JSON.stringify({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "thinking", thinking: "internal" }],
          usage: {
            input: 1,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 3,
            cacheWrite1h: 0,
            reasoning: 0,
            cost: {},
          },
        },
      ],
    });
    const result = extractUsageAndText(ndjson, 50);
    assertEquals(result.text, "");
    assertEquals(result.usage?.input, 1);
    assertEquals(result.usage?.output, 2);
    assertEquals(result.usage?.turns, 1);
  },
);

// ── extractSessionId ─────────────────────────────────────────────────────────

Deno.test("extractSessionId: returns id from session event", () => {
  const ndjson = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "019efc41-6064-70b9-bc99-8656c9148a50",
    }),
    JSON.stringify({ type: "message_update", delta: "hi" }),
  ].join("\n");
  assertEquals(
    extractSessionId(ndjson),
    "019efc41-6064-70b9-bc99-8656c9148a50",
  );
});

Deno.test("extractSessionId: returns null when no session event is present", () => {
  const ndjson = JSON.stringify({ type: "agent_end", messages: [] });
  assertEquals(extractSessionId(ndjson), null);
});

Deno.test("extractSessionId: returns null when session event has no id field", () => {
  const ndjson = [
    JSON.stringify({ type: "session" }),
    JSON.stringify({ type: "agent_end", messages: [] }),
  ].join("\n");
  assertEquals(extractSessionId(ndjson), null);
});

// ── extractClaudeCodeUsageAndText / extractClaudeCodeSessionId ─────────────

const claudeCodeResultNdjson = [
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "cc-session-abc",
  }),
  JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "..." }] },
  }),
  JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "cc-session-abc",
    num_turns: 2,
    duration_ms: 4321,
    total_cost_usd: 0.0123,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
    },
    result: "final assistant text",
    modelUsage: { "claude-sonnet-4-6": { inputTokens: 100, outputTokens: 50 } },
  }),
].join("\n");

Deno.test(
  "extractClaudeCodeUsageAndText: returns result text, mapped usage fields, and durationMs override",
  () => {
    const result = extractClaudeCodeUsageAndText(claudeCodeResultNdjson, 999);
    assertEquals(result.text, "final assistant text");
    assertEquals(result.usage?.input, 100);
    assertEquals(result.usage?.output, 50);
    assertEquals(result.usage?.cacheRead, 10);
    assertEquals(result.usage?.cacheWrite, 5);
    assertEquals(result.usage?.model, "claude-sonnet-4-6");
    assertEquals(result.usage?.durationMs, 999);
    assertEquals(result.usage?.turns, 2);
  },
);

Deno.test(
  "extractClaudeCodeUsageAndText: strips context-window suffix from modelUsage key",
  () => {
    const ndjson = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "text",
      modelUsage: { "claude-opus-4-8[1m]": { inputTokens: 1 } },
    });
    const result = extractClaudeCodeUsageAndText(ndjson, 100);
    assertEquals(result.usage?.model, "claude-opus-4-8");
  },
);

Deno.test(
  "extractClaudeCodeUsageAndText: no result event returns empty text and null usage",
  () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "x" }),
      JSON.stringify({ type: "assistant", message: { content: [] } }),
    ].join("\n");
    const result = extractClaudeCodeUsageAndText(ndjson, 100);
    assertEquals(result.text, "");
    assertEquals(result.usage, null);
  },
);

Deno.test("extractClaudeCodeSessionId: returns session_id from the system init event", () => {
  assertEquals(
    extractClaudeCodeSessionId(claudeCodeResultNdjson),
    "cc-session-abc",
  );
});

Deno.test("extractClaudeCodeSessionId: returns null when no system event is present", () => {
  const ndjson = JSON.stringify({
    type: "result",
    session_id: "should-not-use-this",
  });
  assertEquals(extractClaudeCodeSessionId(ndjson), null);
});

Deno.test("extractClaudeCodeSessionId: returns null when system event has no session_id field", () => {
  const ndjson = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "result", session_id: "x" }),
  ].join("\n");
  assertEquals(extractClaudeCodeSessionId(ndjson), null);
});

Deno.test(
  "executePhase: phase-end log entry includes sessionId when agent stdout contains a session event with an id",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

      const stdout = [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "abc123-session-id",
        }),
        JSON.stringify({ type: "agent_end", messages: [] }),
      ].join("\n");

      const agent: CodeAgent = {
        runPhase() {
          return Promise.resolve({ stdout, stderr: "", code: 0 });
        },
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "out.md",
          phase: "intake",
          scopeDirs: [],
          prompt: "prompt",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );

      const logContent = await Deno.readTextFile(
        join(ticketDir, "log.ndjson"),
      );
      const logLines = logContent.trim().split("\n");
      const endEntry = JSON.parse(logLines[logLines.length - 1]);
      assertEquals(endEntry.event, "phase-end");
      assertEquals(endEntry.sessionId, "abc123-session-id");
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: agentType 'claude-code' uses the Claude Code parser for usage",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

      const resultNdjson = JSON.stringify({
        type: "result",
        subtype: "success",
        num_turns: 1,
        result: "claude code output",
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 7,
          output_tokens: 4,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      });

      const agent: CodeAgent = {
        runPhase() {
          return Promise.resolve({ stdout: resultNdjson, stderr: "", code: 0 });
        },
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "result.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "prompt",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "claude-code",
        },
        agent,
      );

      const usage = JSON.parse(
        await Deno.readTextFile(join(ticketDir, "result.usage.json")),
      );
      assertEquals(usage.input, 7);
      assertEquals(usage.output, 4);
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: phase-end log entry includes sessionId parsed via the Claude Code parser when agentType is claude-code",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

      const stdout = [
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "cc-xyz",
        }),
        JSON.stringify({ type: "result", result: "" }),
      ].join("\n");

      const agent: CodeAgent = {
        runPhase() {
          return Promise.resolve({ stdout, stderr: "", code: 0 });
        },
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "out.md",
          phase: "intake",
          scopeDirs: [],
          prompt: "prompt",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "claude-code",
        },
        agent,
      );

      const logContent = await Deno.readTextFile(join(ticketDir, "log.ndjson"));
      const logLines = logContent.trim().split("\n");
      const endEntry = JSON.parse(logLines[logLines.length - 1]);
      assertEquals(endEntry.sessionId, "cc-xyz");
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

// ── executePhase: costUsd in sidecar ─────────────────────────────────────────

Deno.test(
  "executePhase: includes costUsd in sidecar when pricing cache contains the model",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
      await Deno.mkdir(join(homeDir, ".lazyboy"));

      const pricingCache: AnthropicPricingCache = {
        fetchedAt: Temporal.Now.instant().toString(),
        models: {
          "claude-sonnet-4-6": {
            inputPerMTok: 3,
            outputPerMTok: 15,
            cacheWritePerMTok: 3.75,
            cacheReadPerMTok: 0.30,
          },
        },
      };
      await Deno.writeTextFile(
        join(homeDir, ".lazyboy", "anthropic-pricing.json"),
        JSON.stringify(pricingCache),
      );

      const agentEndNdjson = JSON.stringify({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "output" }],
            usage: {
              input: 1_000_000,
              output: 1_000_000,
              cacheRead: 0,
              cacheWrite: 0,
            },
          },
        ],
      });

      const agent: CodeAgent = {
        runPhase() {
          return Promise.resolve({
            stdout: agentEndNdjson,
            stderr: "",
            code: 0,
          });
        },
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "result.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "p",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );

      const usageRaw = await Deno.readTextFile(
        join(ticketDir, "result.usage.json"),
      );
      const usage = JSON.parse(usageRaw);
      // 1_000_000 * 3/1_000_000 + 1_000_000 * 15/1_000_000 = 18
      assertEquals(usage.costUsd, 18);
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: omits costUsd from sidecar when pricing cache is absent",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

      const agentEndNdjson = JSON.stringify({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "output" }],
            usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      });

      const agent: CodeAgent = {
        runPhase() {
          return Promise.resolve({
            stdout: agentEndNdjson,
            stderr: "",
            code: 0,
          });
        },
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "result.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "p",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );

      const usageRaw = await Deno.readTextFile(
        join(ticketDir, "result.usage.json"),
      );
      const usage = JSON.parse(usageRaw);
      assertFalse("costUsd" in usage);
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: agentType 'claude-code' calls setupClaudeCodeDirectories, not setupPiDirectories",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

      const agent: CodeAgent = {
        runPhase: () => Promise.resolve({ stdout: "", stderr: "", code: 0 }),
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "out.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "p",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "claude-code",
        },
        agent,
      );

      const claudeCodeDir = await Deno.stat(
        join(homeDir, ".lazyboy", "claude-code"),
      );
      assert(claudeCodeDir.isDirectory);

      const settings = JSON.parse(
        await Deno.readTextFile(
          join(homeDir, ".lazyboy", "claude-code", "settings.json"),
        ),
      );
      assertEquals(settings.attribution.commit, "");
      assertEquals(settings.attribution.pr, "");

      let piDirExists = false;
      try {
        await Deno.stat(join(homeDir, ".lazyboy", "pi"));
        piDirExists = true;
      } catch { /* expected */ }
      assertFalse(piDirExists);
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: agentType 'pi' calls setupPiDirectories and injects pi env vars, does not create claude-code dir",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

      let capturedEnv: Record<string, string> = {};
      const agent: CodeAgent = {
        runPhase(opts) {
          capturedEnv = opts.env;
          return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        },
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "out.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "p",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );

      assertEquals(
        capturedEnv.PI_CODING_AGENT_DIR,
        join(homeDir, ".lazyboy", "pi"),
      );

      let claudeCodeDirExists = false;
      try {
        await Deno.stat(join(homeDir, ".lazyboy", "claude-code"));
        claudeCodeDirExists = true;
      } catch { /* expected */ }
      assertFalse(claudeCodeDirExists);
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: omits costUsd from sidecar when model is not in pricing cache",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
      await Deno.mkdir(join(homeDir, ".lazyboy"));
      await Deno.writeTextFile(
        join(homeDir, ".lazyboy", "anthropic-pricing.json"),
        JSON.stringify({
          fetchedAt: Temporal.Now.instant().toString(),
          models: {
            "claude-haiku-4-5": {
              inputPerMTok: 1,
              outputPerMTok: 5,
              cacheWritePerMTok: 1.25,
              cacheReadPerMTok: 0.10,
            },
          },
        }),
      );

      const agentEndNdjson = JSON.stringify({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            model: "claude-unknown-model",
            content: [{ type: "text", text: "output" }],
            usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      });

      const agent: CodeAgent = {
        runPhase() {
          return Promise.resolve({
            stdout: agentEndNdjson,
            stderr: "",
            code: 0,
          });
        },
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "result.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "p",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );

      const usageRaw = await Deno.readTextFile(
        join(ticketDir, "result.usage.json"),
      );
      const usage = JSON.parse(usageRaw);
      assertFalse("costUsd" in usage);
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: agentType 'claude-code' calls setupClaudeCodeDirectories, not setupPiDirectories",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

      const agent: CodeAgent = {
        runPhase: () => Promise.resolve({ stdout: "", stderr: "", code: 0 }),
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "out.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "p",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "claude-code",
        },
        agent,
      );

      const claudeCodeDir = await Deno.stat(
        join(homeDir, ".lazyboy", "claude-code"),
      );
      assert(claudeCodeDir.isDirectory);

      const settings = JSON.parse(
        await Deno.readTextFile(
          join(homeDir, ".lazyboy", "claude-code", "settings.json"),
        ),
      );
      assertEquals(settings.attribution.commit, "");
      assertEquals(settings.attribution.pr, "");

      let piDirExists = false;
      try {
        await Deno.stat(join(homeDir, ".lazyboy", "pi"));
        piDirExists = true;
      } catch { /* expected */ }
      assertFalse(piDirExists);
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "executePhase: agentType 'pi' calls setupPiDirectories and injects pi env vars, does not create claude-code dir",
  async () => {
    const ticketDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

      let capturedEnv: Record<string, string> = {};
      const agent: CodeAgent = {
        runPhase(opts) {
          capturedEnv = opts.env;
          return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        },
      };

      await executePhase(
        {
          ticketDir,
          stateDir: dirname(ticketDir),
          outputFile: "out.md",
          phase: "spec",
          scopeDirs: [],
          prompt: "p",
          worktrees: {},
          homeDir,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          thinking: "off",
          agentType: "pi",
        },
        agent,
      );

      assertEquals(
        capturedEnv.PI_CODING_AGENT_DIR,
        join(homeDir, ".lazyboy", "pi"),
      );

      let claudeCodeDirExists = false;
      try {
        await Deno.stat(join(homeDir, ".lazyboy", "claude-code"));
        claudeCodeDirExists = true;
      } catch { /* expected */ }
      assertFalse(claudeCodeDirExists);
    } finally {
      await Deno.remove(ticketDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

// ── extractUsageAndText: tool counting ───────────────────────────────────────

Deno.test("extractUsageAndText: single tool_use item counted into usage.tools", () => {
  const ndjson = JSON.stringify({
    type: "agent_end",
    messages: [
      {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "tool_use", name: "read", input: {} }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
  const result = extractUsageAndText(ndjson, 100);
  assertEquals(result.usage?.tools, { read: 1 });
});

Deno.test("extractUsageAndText: tool_use items across multiple assistant messages are counted and aggregated", () => {
  const ndjson = JSON.stringify({
    type: "agent_end",
    messages: [
      {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          { type: "tool_use", name: "read", input: {} },
          { type: "tool_use", name: "read", input: {} },
        ],
        usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0 },
      },
      { role: "user", content: [{ type: "tool_result", text: "" }] },
      {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          { type: "tool_use", name: "write", input: {} },
          { type: "text", text: "done" },
        ],
        usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
  const result = extractUsageAndText(ndjson, 100);
  assertEquals(result.usage?.tools, { read: 2, write: 1 });
});

Deno.test("extractUsageAndText: no tool_use items leaves usage.tools undefined", () => {
  const result = extractUsageAndText(singleTurnNdjson, 100);
  assertEquals(result.usage?.tools, undefined);
});

// ── extractClaudeCodeUsageAndText: tool counting ─────────────────────────────

Deno.test("extractClaudeCodeUsageAndText: tool_use items from assistant events are counted and lowercased", () => {
  const ndjson = [
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
    }),
    JSON.stringify({
      type: "result",
      result: "text",
      num_turns: 1,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }),
  ].join("\n");
  const result = extractClaudeCodeUsageAndText(ndjson, 100);
  assertEquals(result.usage?.tools, { read: 1 });
});

Deno.test("extractClaudeCodeUsageAndText: tool_use items across multiple assistant events are aggregated", () => {
  const ndjson = [
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: {} },
          { type: "tool_use", name: "Bash", input: {} },
        ],
      },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: {} }],
      },
    }),
    JSON.stringify({
      type: "result",
      result: "text",
      num_turns: 2,
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }),
  ].join("\n");
  const result = extractClaudeCodeUsageAndText(ndjson, 100);
  assertEquals(result.usage?.tools, { read: 2, bash: 1 });
});

Deno.test("extractClaudeCodeUsageAndText: no tool_use content leaves usage.tools undefined", () => {
  const result = extractClaudeCodeUsageAndText(claudeCodeResultNdjson, 100);
  assertEquals(result.usage?.tools, undefined);
});

// ── executePhase: tools in sidecar ───────────────────────────────────────────

Deno.test("executePhase: usage sidecar includes tools when agent stdout contains tool_use items", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    const stdout = JSON.stringify({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            { type: "tool_use", name: "read", input: {} },
            { type: "tool_use", name: "read", input: {} },
            { type: "tool_use", name: "bash", input: {} },
          ],
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    const agent: CodeAgent = {
      runPhase: () => Promise.resolve({ stdout, stderr: "", code: 0 }),
    };
    await executePhase(
      {
        ticketDir,
        stateDir: dirname(ticketDir),
        outputFile: "result.md",
        phase: "spec",
        scopeDirs: [],
        prompt: "p",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );
    const usage = JSON.parse(
      await Deno.readTextFile(join(ticketDir, "result.usage.json")),
    );
    assertEquals(usage.tools, { read: 2, bash: 1 });
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: usage sidecar omits tools when agent stdout has no tool_use items", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    const stdout = JSON.stringify({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "output" }],
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    const agent: CodeAgent = {
      runPhase: () => Promise.resolve({ stdout, stderr: "", code: 0 }),
    };
    await executePhase(
      {
        ticketDir,
        stateDir: dirname(ticketDir),
        outputFile: "result.md",
        phase: "spec",
        scopeDirs: [],
        prompt: "p",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );
    const usage = JSON.parse(
      await Deno.readTextFile(join(ticketDir, "result.usage.json")),
    );
    assertFalse("tools" in usage);
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

// ── executePhase: sessionId threading ────────────────────────────────────────

Deno.test("executePhase: passes sessionId to agent.runPhase when provided", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    let capturedSessionId: string | undefined;
    const agent: CodeAgent = {
      runPhase(opts) {
        capturedSessionId = opts.sessionId;
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      },
    };
    await executePhase(
      {
        ticketDir,
        stateDir: dirname(ticketDir),
        outputFile: "out.md",
        phase: "implementation",
        scopeDirs: [],
        prompt: "do thing",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
        sessionId: "sess-42",
      },
      agent,
    );
    assertEquals(capturedSessionId, "sess-42");
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: passes undefined sessionId to agent when not provided", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");
    let capturedSessionId: string | undefined = "sentinel";
    const agent: CodeAgent = {
      runPhase(opts) {
        capturedSessionId = opts.sessionId;
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      },
    };
    await executePhase(
      {
        ticketDir,
        stateDir: dirname(ticketDir),
        outputFile: "out.md",
        phase: "implementation",
        scopeDirs: [],
        prompt: "do thing",
        worktrees: {},
        homeDir,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinking: "off",
        agentType: "pi",
      },
      agent,
    );
    assertEquals(capturedSessionId, undefined);
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});
