import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  detectImplementationOutlier,
  detectPlanOutlier,
} from "./outlier-detection.ts";

Deno.test("detectImplementationOutlier: returns null when no plan file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-implementation.usage.json"),
      JSON.stringify({ turns: 100 }),
    );
    assertEquals(await detectImplementationOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectImplementationOutlier: returns null when no usage file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.md"),
      "## Task 1\n\nDo something.\n",
    );
    assertEquals(await detectImplementationOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectImplementationOutlier: returns null when turns is undefined", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.md"),
      "## Task 1\n\nDo something.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-implementation.usage.json"),
      JSON.stringify({ input: 1000, output: 200 }),
    );
    assertEquals(await detectImplementationOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectImplementationOutlier: returns null when task_count is 0", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.md"),
      "No task headings here.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-implementation.usage.json"),
      JSON.stringify({ turns: 100 }),
    );
    assertEquals(await detectImplementationOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectImplementationOutlier: returns null when turns <= 5 * task_count", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.md"),
      "## Task 1\n\nWork.\n\n## Task 2\n\nMore work.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-implementation.usage.json"),
      JSON.stringify({ turns: 10 }),
    );
    assertEquals(await detectImplementationOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectImplementationOutlier: returns result when turns > 5 * task_count", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.md"),
      "## Task 1\n\nWork.\n\n## Task 2\n\nMore work.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-implementation.usage.json"),
      JSON.stringify({ turns: 11 }),
    );
    assertEquals(await detectImplementationOutlier(dir), {
      turns: 11,
      taskCount: 2,
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectImplementationOutlier: counts ## Task and ### Task headings case-insensitively", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.md"),
      "## task 1\n\nWork.\n\n### Task 2\n\nMore work.\n\n## TASK 3\n\nYet more.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-implementation.usage.json"),
      JSON.stringify({ turns: 16 }),
    );
    assertEquals(await detectImplementationOutlier(dir), {
      turns: 16,
      taskCount: 3,
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectImplementationOutlier: uses latest plan file by timestamp", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.md"),
      "## Task 1\n\nWork.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260102T000000-plan.md"),
      "No task headings.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-implementation.usage.json"),
      JSON.stringify({ turns: 100 }),
    );
    assertEquals(await detectImplementationOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectImplementationOutlier: uses latest usage file by timestamp", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.md"),
      "## Task 1\n\nWork.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-implementation.usage.json"),
      JSON.stringify({ turns: 100 }),
    );
    await Deno.writeTextFile(
      join(dir, "20260102T000000-implementation.usage.json"),
      JSON.stringify({ turns: 4 }),
    );
    assertEquals(await detectImplementationOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectImplementationOutlier: returns null when ticketDir does not exist", async () => {
  assertEquals(await detectImplementationOutlier("/nonexistent/dir/xyz"), null);
});

Deno.test("detectPlanOutlier: returns null when no spec file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.usage.json"),
      JSON.stringify({ turns: 100 }),
    );
    assertEquals(await detectPlanOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectPlanOutlier: returns null when no plan usage file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-spec.md"),
      "### Criterion 1\n\nDetails.\n",
    );
    assertEquals(await detectPlanOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectPlanOutlier: returns null when turns is undefined", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-spec.md"),
      "### Criterion 1\n\nDetails.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.usage.json"),
      JSON.stringify({ input: 1000, output: 200 }),
    );
    assertEquals(await detectPlanOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectPlanOutlier: returns null when criterionCount is 0", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-spec.md"),
      "No criterion headings here.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.usage.json"),
      JSON.stringify({ turns: 100 }),
    );
    assertEquals(await detectPlanOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectPlanOutlier: returns null when turns <= 5 * criterionCount", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-spec.md"),
      "### Criterion 1\n\nDetails.\n\n### Criterion 2\n\nMore.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.usage.json"),
      JSON.stringify({ turns: 10 }),
    );
    assertEquals(await detectPlanOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectPlanOutlier: returns result when turns > 5 * criterionCount", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-spec.md"),
      "### Criterion 1\n\nDetails.\n\n### Criterion 2\n\nMore.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.usage.json"),
      JSON.stringify({ turns: 11 }),
    );
    assertEquals(await detectPlanOutlier(dir), {
      turns: 11,
      criterionCount: 2,
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectPlanOutlier: does not count ## headings, only ###", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-spec.md"),
      "## What to Build\n\n### Criterion 1\n\nDetails.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.usage.json"),
      JSON.stringify({ turns: 6 }),
    );
    assertEquals(await detectPlanOutlier(dir), { turns: 6, criterionCount: 1 });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectPlanOutlier: uses latest spec file by timestamp", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-spec.md"),
      "### Criterion 1\n\nDetails.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260102T000000-spec.md"),
      "No headings.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.usage.json"),
      JSON.stringify({ turns: 100 }),
    );
    assertEquals(await detectPlanOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectPlanOutlier: uses latest plan usage file by timestamp", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "20260101T000000-spec.md"),
      "### Criterion 1\n\nDetails.\n",
    );
    await Deno.writeTextFile(
      join(dir, "20260101T000000-plan.usage.json"),
      JSON.stringify({ turns: 100 }),
    );
    await Deno.writeTextFile(
      join(dir, "20260102T000000-plan.usage.json"),
      JSON.stringify({ turns: 4 }),
    );
    assertEquals(await detectPlanOutlier(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("detectPlanOutlier: returns null when ticketDir does not exist", async () => {
  assertEquals(await detectPlanOutlier("/nonexistent/dir/xyz"), null);
});
