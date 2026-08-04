import { assertFalse, assertStringIncludes } from "@std/assert";
import { plistContent } from "./launchd.ts";

Deno.test("plistContent: includes the label", () => {
  assertStringIncludes(
    plistContent("/home/user/.lazyboy"),
    "com.jackjennings.lazyboy",
  );
});

Deno.test("plistContent: StartInterval is 300", () => {
  assertStringIncludes(
    plistContent("/home/user/.lazyboy"),
    "<integer>300</integer>",
  );
});

Deno.test("plistContent: RunAtLoad is true", () => {
  assertStringIncludes(plistContent("/home/user/.lazyboy"), "<true/>");
});

Deno.test("plistContent: references tick.sh at lazboyDir", () => {
  assertStringIncludes(
    plistContent("/home/user/.lazyboy"),
    "/home/user/.lazyboy/scripts/tick.sh",
  );
});

Deno.test("plistContent: does not contain tick.ndjson", () => {
  assertFalse(plistContent("/home/user/.lazyboy").includes("tick.ndjson"));
});

Deno.test("plistContent: does not contain StandardOutPath", () => {
  assertFalse(plistContent("/home/user/.lazyboy").includes("StandardOutPath"));
});

Deno.test("plistContent: does not contain StandardErrorPath", () => {
  assertFalse(
    plistContent("/home/user/.lazyboy").includes("StandardErrorPath"),
  );
});
