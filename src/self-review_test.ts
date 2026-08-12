import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { join } from "@std/path";
import { selfReview } from "./self-review.ts";
import type { CommandRunner } from "./apfel.ts";

function runnerReturning(stdout: string, code = 0): CommandRunner {
  return spy((_args: string[]) => Promise.resolve({ code, stdout }));
}

Deno.test("selfReview: returns false when no self-review prompt exists for phase", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const run = runnerReturning("APPROVE");
    const result = await selfReview("spec", tempDir, run);
    assertEquals(result, { approved: false, reason: null });
    assertSpyCalls(run as ReturnType<typeof spy>, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns false when no phase output file is found", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const run = runnerReturning("APPROVE");
    const result = await selfReview("intake", tempDir, run);
    assertEquals(result, { approved: false, reason: null });
    assertSpyCalls(run as ReturnType<typeof spy>, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns approved when claude CLI outputs APPROVE", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "## Proposed Scope\n\n```yaml\nscope:\n  - /Users/jack/code/myorg/repo\n```\n",
    );
    const run = runnerReturning("APPROVE");
    const result = await selfReview("intake", tempDir, run);
    assertEquals(result, { approved: true, reason: null });
    assertSpyCalls(run as ReturnType<typeof spy>, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns not approved when claude CLI outputs REJECT", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "bad output",
    );
    const run = runnerReturning("REJECT");
    const result = await selfReview("intake", tempDir, run);
    assertEquals(result, { approved: false, reason: "REJECT" });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns false when claude CLI exits non-zero", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const run = runnerReturning("", 1);
    const result = await selfReview("intake", tempDir, run);
    assertEquals(result, { approved: false, reason: null });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns false when run throws", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const run: CommandRunner = spy((_args: string[]) =>
      Promise.reject(new Error("not found"))
    );
    const result = await selfReview("intake", tempDir, run);
    assertEquals(result, { approved: false, reason: null });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: passes output file content after -- to claude", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const outputContent =
      "## Proposed Scope\n\n```yaml\nscope:\n  - /code/repo\n```\n";
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      outputContent,
    );
    const run = runnerReturning("APPROVE");
    await selfReview("intake", tempDir, run);
    const args = (run as ReturnType<typeof spy>).calls[0].args[0] as string[];
    assertEquals(args[0], "claude");
    assertEquals(args[args.length - 1], outputContent);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: passes --system-prompt containing APPROVE and REJECT to claude", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const run = runnerReturning("APPROVE");
    await selfReview("intake", tempDir, run);
    const args = (run as ReturnType<typeof spy>).calls[0].args[0] as string[];
    const promptIdx = args.indexOf("--system-prompt");
    assertNotEquals(promptIdx, -1);
    assertStringIncludes(args[promptIdx + 1], "APPROVE");
    assertStringIncludes(args[promptIdx + 1], "REJECT");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: passes --model claude-haiku-4-5 to claude", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const run = runnerReturning("APPROVE");
    await selfReview("intake", tempDir, run);
    const args = (run as ReturnType<typeof spy>).calls[0].args[0] as string[];
    const modelIdx = args.indexOf("--model");
    assertNotEquals(modelIdx, -1);
    assertEquals(args[modelIdx + 1], "claude-haiku-4-5");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: APPROVE is case-insensitive", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "output",
    );
    const result = await selfReview(
      "intake",
      tempDir,
      runnerReturning("approve"),
    );
    assertEquals(result, { approved: true, reason: null });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: returns reason text when claude outputs REJECT with explanation", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-intake.md"),
      "bad output",
    );
    const run = runnerReturning(
      "REJECT\nCriterion 2 was violated because the scope list is missing.",
    );
    const result = await selfReview("intake", tempDir, run);
    assertEquals(result, {
      approved: false,
      reason:
        "REJECT\nCriterion 2 was violated because the scope list is missing.",
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("selfReview: works for enrichment phase when output file exists", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tempDir, "20260717T120000-enrichment.md"),
      "## Relevant Code\n\nFile: src/main.ts\n",
    );
    const result = await selfReview(
      "enrichment",
      tempDir,
      runnerReturning("APPROVE"),
    );
    assertEquals(result, { approved: true, reason: null });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "intake-self-review.md criterion 3 accepts GitHub slug and URL formats",
  async () => {
    const promptPath = new URL(
      "./phases/prompts/intake-self-review.md",
      import.meta.url,
    ).pathname;
    const content = await Deno.readTextFile(promptPath);
    assertStringIncludes(content, "https://github.com/");
    assertStringIncludes(content, "org/repo");
  },
);
