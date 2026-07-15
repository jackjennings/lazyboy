import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  appendPhaseLog,
  buildContextFiles,
  getPiEnvironmentVariables,
  setupPiDirectories,
} from "./run-phase.ts";

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
