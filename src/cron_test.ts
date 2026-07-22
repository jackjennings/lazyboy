import { assertEquals, assertStringIncludes } from "@std/assert";
import { cronLine } from "./cron.ts";

Deno.test("cronLine: contains the lazyboy marker", () => {
  const line = cronLine("/home/user/.lazyboy");
  assertStringIncludes(line, "# lazyboy");
});

Deno.test("cronLine: references the tick.sh script", () => {
  const line = cronLine("/home/user/.lazyboy");
  assertStringIncludes(line, "/home/user/.lazyboy/scripts/tick.sh");
});

Deno.test("cronLine: does not redirect stdout/stderr to tick.ndjson", () => {
  const line = cronLine("/home/user/.lazyboy");
  assertEquals(line.includes("tick.log"), false);
  assertEquals(line.includes(">>"), false);
  assertEquals(line.includes("2>&1"), false);
});
