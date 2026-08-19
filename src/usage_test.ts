import { assertEquals } from "@std/assert";
import { formatLargeTokens } from "./usage.ts";

Deno.test("formatLargeTokens: raw integer under 1000", () => {
  assertEquals(formatLargeTokens(0), "0");
  assertEquals(formatLargeTokens(999), "999");
});

Deno.test("formatLargeTokens: one-decimal k for 1000–999999", () => {
  assertEquals(formatLargeTokens(1000), "1.0k");
  assertEquals(formatLargeTokens(90900), "90.9k");
  assertEquals(formatLargeTokens(853600), "853.6k");
});

Deno.test("formatLargeTokens: one-decimal m for >= 1000000", () => {
  assertEquals(formatLargeTokens(1_000_000), "1.0m");
  assertEquals(formatLargeTokens(2_200_000), "2.2m");
});
