import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import migration from "./1787068800-notion-to-document.ts";
import { makeTicket } from "../src/test-support.ts";

Deno.test("migration notion-to-document: notion artifact with notionPages is converted to document with documents", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const id = "github/org/repo/1";
    await Deno.mkdir(join(dir, id), { recursive: true });
    await Deno.writeTextFile(
      join(dir, id, "meta.md"),
      `---
artifact: notion
notionPages:
  - url: https://notion.so/abc
    title: My Doc
---
body
`,
    );
    const ticket = makeTicket({ id, artifact: "code" });
    const result = await migration.run(ticket, dir);
    assertEquals(result.artifact, "document");
    assertEquals(result.documents, [{
      url: "https://notion.so/abc",
      title: "My Doc",
    }]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migration notion-to-document: document ticket passes through unchanged", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const id = "github/org/repo/2";
    await Deno.mkdir(join(dir, id), { recursive: true });
    const pages = [{ url: "https://notion.so/abc", title: "My Doc" }];
    await Deno.writeTextFile(
      join(dir, id, "meta.md"),
      `---
artifact: document
documents:
  - url: https://notion.so/abc
    title: My Doc
---
body
`,
    );
    const ticket = makeTicket({ id, artifact: "document", documents: pages });
    const result = await migration.run(ticket, dir);
    assertEquals(result.artifact, "document");
    assertEquals(result.documents, pages);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migration notion-to-document: code ticket passes through unchanged", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const id = "github/org/repo/3";
    await Deno.mkdir(join(dir, id), { recursive: true });
    await Deno.writeTextFile(
      join(dir, id, "meta.md"),
      `---
artifact: code
---
body
`,
    );
    const ticket = makeTicket({ id, artifact: "code" });
    const result = await migration.run(ticket, dir);
    assertEquals(result.artifact, "code");
    assertEquals(result.documents, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
