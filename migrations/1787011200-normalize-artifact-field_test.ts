import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import migration from "./1787011200-normalize-artifact-field.ts";
import { readTicket, writeTicket } from "../src/state/store.ts";

async function writeLegacyTicket(
  stateDir: string,
  id: string,
  artifactValue: string,
): Promise<void> {
  const ticketDir = join(stateDir, id);
  await Deno.mkdir(ticketDir, { recursive: true });
  const artifactLine = artifactValue ? `artifact: ${artifactValue}\n` : "";
  await Deno.writeTextFile(
    join(ticketDir, "meta.md"),
    `---
id: ${id}
provider: github
title: T
url: https://github.com/x/y/issues/1
phase: intake
status: new
${artifactLine}scope: []
worktrees: {}
approvals: []
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
---
`,
  );
}

Deno.test("migration normalize-artifact-field: legacy artifact:notion → artifacts:[document] after write", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await writeLegacyTicket(stateDir, "github/x/y/1", "notion");
    const ticket = await readTicket(stateDir, "github/x/y/1");
    const migrated = await migration.run(ticket, stateDir);
    await writeTicket(stateDir, migrated);
    const raw = await Deno.readTextFile(
      join(stateDir, "github/x/y/1", "meta.md"),
    );
    assertStringIncludes(raw, "artifacts:");
    assertFalse(raw.includes("artifact: notion"));
    const reread = await readTicket(stateDir, "github/x/y/1");
    assertEquals(reread.artifacts, ["document"]);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration normalize-artifact-field: legacy artifact:code → artifacts:[code] after write", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await writeLegacyTicket(stateDir, "github/x/y/1", "code");
    const ticket = await readTicket(stateDir, "github/x/y/1");
    const migrated = await migration.run(ticket, stateDir);
    await writeTicket(stateDir, migrated);
    const raw = await Deno.readTextFile(
      join(stateDir, "github/x/y/1", "meta.md"),
    );
    assertStringIncludes(raw, "artifacts:");
    assertFalse(raw.includes("artifact: code"));
    const reread = await readTicket(stateDir, "github/x/y/1");
    assertEquals(reread.artifacts, ["code"]);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("migration normalize-artifact-field: absent artifact field → artifacts:[code] after write", async () => {
  const stateDir = await Deno.makeTempDir();
  try {
    await writeLegacyTicket(stateDir, "github/x/y/1", "");
    const ticket = await readTicket(stateDir, "github/x/y/1");
    const migrated = await migration.run(ticket, stateDir);
    await writeTicket(stateDir, migrated);
    const raw = await Deno.readTextFile(
      join(stateDir, "github/x/y/1", "meta.md"),
    );
    assertStringIncludes(raw, "artifacts:");
    assertFalse(raw.includes("artifact:"));
    const reread = await readTicket(stateDir, "github/x/y/1");
    assertEquals(reread.artifacts, ["code"]);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
