import { assert, assertEquals, assertFalse } from "@std/assert";
import { compactTimestamp } from "./timestamp.ts";

Deno.test("compactTimestamp: formats a known datetime to YYYYMMDDTHHMMSS", () => {
  const zdt = Temporal.ZonedDateTime.from("2026-06-29T22:46:53+00:00[UTC]");
  assertEquals(compactTimestamp(zdt), "20260629T224653");
});

Deno.test("compactTimestamp: zero-pads single-digit month, day, hour, minute, second", () => {
  const zdt = Temporal.ZonedDateTime.from("2026-01-05T03:07:09+00:00[UTC]");
  assertEquals(compactTimestamp(zdt), "20260105T030709");
});

Deno.test("compactTimestamp: result contains no hyphens in the date portion", () => {
  const zdt = Temporal.ZonedDateTime.from("2026-12-31T23:59:59+00:00[UTC]");
  const result = compactTimestamp(zdt);
  assertFalse(result.includes("-"));
  assert(/^\d{8}T\d{6}$/.test(result));
});
