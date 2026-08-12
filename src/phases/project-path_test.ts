import { assertEquals } from "@std/assert";
import { deriveProjectPath } from "./project-path.ts";

Deno.test("deriveProjectPath: extracts org/repo from github ticket id", () => {
  assertEquals(
    deriveProjectPath("github", "github/jackjennings/lazyboy/410"),
    "jackjennings/lazyboy",
  );
});

Deno.test("deriveProjectPath: extracts project key from jira ticket id", () => {
  assertEquals(deriveProjectPath("jira", "jira/PROJ-123"), "PROJ");
});

Deno.test("deriveProjectPath: returns empty string for unknown provider", () => {
  assertEquals(deriveProjectPath("unknown", "unknown/foo/bar"), "");
});
