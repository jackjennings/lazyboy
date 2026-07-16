import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  appendPhaseLog,
  buildContextFiles,
  executePhase,
  getPiEnvironmentVariables,
  setupPiDirectories,
} from "./run-phase.ts";
import type { CodeAgent } from "./agents/types.ts";

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

    assertEquals(piDir.isDirectory, true);
    assertEquals(sessionsDir.isDirectory, true);
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
    assertEquals(piDir.isDirectory, true);
  } finally {
    await Deno.remove(tempHome, { recursive: true });
  }
});

// ── Integration test ─────────────────────────────────────────────────────────

Deno.test("run-phase: pi invocation includes isolated config variables", async () => {
  const tempHome = await Deno.makeTempDir();

  try {
    const env = getPiEnvironmentVariables(tempHome);
    await setupPiDirectories(tempHome);

    // Verify the environment variables point to lazyboy-specific paths
    assertEquals(env.PI_CODING_AGENT_DIR, join(tempHome, ".lazyboy", "pi"));
    assertEquals(
      env.PI_CODING_AGENT_SESSION_DIR,
      join(tempHome, ".lazyboy", "pi", "sessions"),
    );

    // Verify directories exist
    const piDir = await Deno.stat(env.PI_CODING_AGENT_DIR);
    const sessionsDir = await Deno.stat(env.PI_CODING_AGENT_SESSION_DIR);
    assertEquals(piDir.isDirectory, true);
    assertEquals(sessionsDir.isDirectory, true);
  } finally {
    await Deno.remove(tempHome, { recursive: true });
  }
});

// ── buildContextFiles ────────────────────────────────────────────────────────

Deno.test("buildContextFiles: always includes meta.md", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    const files = await buildContextFiles(tempDir);
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
    const files = await buildContextFiles(tempDir);
    assertEquals(
      files.includes(`@${tempDir}/20260629T154506-intake.md`),
      true,
    );
    assertEquals(files.includes(`@${tempDir}/20260629T154506-spec.md`), true);
    assertEquals(
      files.includes(`@${tempDir}/20260629T154506-enrichment.md`),
      false,
    );
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
    const files = await buildContextFiles(tempDir);
    const outIdx = files.indexOf(`@${tempDir}/20260629T154506-intake.md`);
    const fbIdx = files.indexOf(
      `@${tempDir}/20260629T160000-intake-feedback.md`,
    );
    assertEquals(outIdx !== -1, true);
    assertEquals(fbIdx !== -1, true);
    assertEquals(outIdx < fbIdx, true);
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
    const files = await buildContextFiles(tempDir);
    assertEquals(
      files.includes(`@${tempDir}/20260629T154506-diff.md`),
      false,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
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
        outputFile: "out.md",
        phase: "intake",
        scopeDirs: [],
        prompt: "do the thing",
        worktrees: {},
        homeDir,
      },
      agent,
    );

    assertEquals(capturedContextFiles.includes(`@${ticketDir}/meta.md`), true);
    assertEquals(
      capturedContextFiles.includes(
        `@${ticketDir}/20260101T000000-intake.md`,
      ),
      true,
    );
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
        outputFile: "out.md",
        phase: "intake",
        scopeDirs: ["/some/scope"],
        prompt: "base prompt",
        worktrees: { repo: { path: "/some/worktree", branch: "main" } },
        homeDir,
      },
      agent,
    );

    assertEquals(capturedPrompt.startsWith("base prompt"), true);
    assertEquals(capturedPrompt.includes(ticketDir), true);
    assertEquals(capturedPrompt.includes("/some/scope"), true);
    assertEquals(capturedPrompt.includes("/some/worktree"), true);
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: passes PI_PROVIDER and PI_MODEL to agent.runPhase", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

    let capturedProvider = "";
    let capturedModel = "";
    const agent: CodeAgent = {
      runPhase(opts) {
        capturedProvider = opts.provider;
        capturedModel = opts.model;
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      },
    };

    await executePhase(
      {
        ticketDir,
        outputFile: "out.md",
        phase: "intake",
        scopeDirs: [],
        prompt: "prompt",
        worktrees: {},
        homeDir,
      },
      agent,
    );

    assertEquals(capturedProvider, "anthropic");
    assertEquals(capturedModel, "claude-sonnet-4-6");
  } finally {
    await Deno.remove(ticketDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("executePhase: writes stdout to output file, logs phase-end with exitCode and stderr, returns exit code", async () => {
  const ticketDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(ticketDir, "meta.md"), "---\n---\n");

    const agent: CodeAgent = {
      runPhase() {
        return Promise.resolve({
          stdout: "agent output",
          stderr: "agent errors",
          code: 42,
        });
      },
    };

    const exitCode = await executePhase(
      {
        ticketDir,
        outputFile: "result.md",
        phase: "spec",
        scopeDirs: [],
        prompt: "prompt",
        worktrees: {},
        homeDir,
      },
      agent,
    );

    assertEquals(exitCode, 42);

    const written = await Deno.readTextFile(join(ticketDir, "result.md"));
    assertEquals(written, "agent output");

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
});
