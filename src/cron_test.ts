import { assertEquals, assertStringIncludes } from "@std/assert";
import { cronLine, detectCronEnabled } from "./cron.ts";

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

Deno.test("detectCronEnabled: returns true for an active marker line", () => {
  const content = `*/5 * * * * /home/user/.lazyboy/scripts/tick.sh # lazyboy\n`;
  assertEquals(detectCronEnabled(content), true);
});

Deno.test("detectCronEnabled: returns false when marker line is commented out", () => {
  const content =
    `#*/5 * * * * /home/user/.lazyboy/scripts/tick.sh # lazyboy\n`;
  assertEquals(detectCronEnabled(content), false);
});

Deno.test("detectCronEnabled: returns false when no marker is present", () => {
  const content = `*/5 * * * * /usr/bin/env backup.sh\n`;
  assertEquals(detectCronEnabled(content), false);
});

Deno.test("detectCronEnabled: returns false for empty crontab", () => {
  assertEquals(detectCronEnabled(""), false);
});
