import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
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

Deno.test("buildContextFiles: includes canonical phase files that exist", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(join(tempDir, "intake.md"), "intake");
    await Deno.writeTextFile(join(tempDir, "spec.md"), "spec");
    const files = await buildContextFiles(tempDir);
    assertEquals(files.includes(`@${tempDir}/intake.md`), true);
    assertEquals(files.includes(`@${tempDir}/spec.md`), true);
    assertEquals(files.includes(`@${tempDir}/enrichment.md`), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: includes phase revision and feedback files sorted alphabetically after canonical", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(join(tempDir, "intake.md"), "intake");
    await Deno.writeTextFile(
      join(tempDir, "intake-20260629T154506.md"),
      "rev1",
    );
    await Deno.writeTextFile(
      join(tempDir, "intake-feedback-2026-06-29T160000.md"),
      "feedback",
    );
    const files = await buildContextFiles(tempDir);
    const canonIdx = files.indexOf(`@${tempDir}/intake.md`);
    const revIdx = files.indexOf(`@${tempDir}/intake-20260629T154506.md`);
    const fbIdx = files.indexOf(
      `@${tempDir}/intake-feedback-2026-06-29T160000.md`,
    );
    assertEquals(canonIdx !== -1, true);
    assertEquals(revIdx !== -1, true);
    assertEquals(fbIdx !== -1, true);
    assertEquals(canonIdx < revIdx, true);
    assertEquals(revIdx < fbIdx, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("buildContextFiles: does not include files for phases not in context list", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tempDir, "meta.md"), "---\n---\n");
    await Deno.writeTextFile(join(tempDir, "diff.md"), "diff");
    const files = await buildContextFiles(tempDir);
    assertEquals(files.includes(`@${tempDir}/diff.md`), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
