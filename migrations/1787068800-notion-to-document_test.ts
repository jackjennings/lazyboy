import { assertEquals } from "@std/assert";
import migration from "./1787068800-notion-to-document.ts";
import { makeTicket } from "../src/test-support.ts";

const STATE_DIR = "/tmp/unused";

Deno.test("migration notion-to-document: document ticket with documents passes through unchanged", async () => {
  const pages = [{ url: "https://notion.so/abc", title: "My Doc" }];
  const ticket = makeTicket({ artifact: "document", documents: pages });
  const result = await migration.run(ticket, STATE_DIR);
  assertEquals(result.artifact, "document");
  assertEquals(result.documents, pages);
});

Deno.test("migration notion-to-document: code ticket passes through unchanged", async () => {
  const ticket = makeTicket({ artifact: "code" });
  const result = await migration.run(ticket, STATE_DIR);
  assertEquals(result.artifact, "code");
  assertEquals(result.documents, undefined);
});
