import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { formatDoctorReport } from "./formatter.ts";
import type { Check } from "./checks/types.ts";

const makeCheck = (id: string, description: string): Check => ({
  id,
  description,
  run: () =>
    Promise.resolve<{ status: "pass"; detail: string }>({
      status: "pass",
      detail: "",
    }),
});

Deno.test("formatDoctorReport: pass result — status tag and description only", () => {
  const output = formatDoctorReport(
    [makeCheck("x", "All good")],
    [{ status: "pass", detail: "" }],
  );
  assertStringIncludes(output, "[PASS] All good");
  assertFalse(output.includes("Remedy:"));
});

Deno.test(
  "formatDoctorReport: warn result — shows indented detail and remedy",
  () => {
    const output = formatDoctorReport(
      [makeCheck("x", "Concern")],
      [{ status: "warn", detail: "watch out", remedy: "do x" }],
    );
    assertStringIncludes(output, "[WARN] Concern");
    assertStringIncludes(output, "       watch out");
    assertStringIncludes(output, "       Remedy: do x");
  },
);

Deno.test("formatDoctorReport: fail without remedy omits remedy line", () => {
  const output = formatDoctorReport(
    [makeCheck("x", "Broken")],
    [{ status: "fail", detail: "it failed" }],
  );
  assertStringIncludes(output, "[FAIL] Broken");
  assertStringIncludes(output, "it failed");
  assertFalse(output.includes("Remedy:"));
});

Deno.test("formatDoctorReport: empty detail string is omitted", () => {
  const lines = formatDoctorReport(
    [makeCheck("x", "Check")],
    [{ status: "fail", detail: "" }],
  ).split("\n");
  assertEquals(lines.length, 1);
});

Deno.test("formatDoctorReport: multiple checks joined by newline", () => {
  const checks = [makeCheck("a", "A"), makeCheck("b", "B")];
  const results = [
    { status: "pass" as const, detail: "" },
    { status: "fail" as const, detail: "bad" },
  ];
  const output = formatDoctorReport(checks, results);
  assertStringIncludes(output, "[PASS] A\n[FAIL] B");
});
