import { assertEquals, assertStringIncludes } from "@std/assert";
import { runChecks } from "./runner.ts";
import type { Check } from "./checks/types.ts";

Deno.test(
  "runChecks: thrown error produces fail result and run continues",
  async () => {
    const checks: Check[] = [
      {
        id: "a",
        description: "Boom",
        run: () => Promise.reject(new Error("BOOM")),
      },
      {
        id: "b",
        description: "Fine",
        run: () =>
          Promise.resolve<{ status: "pass"; detail: string }>({
            status: "pass",
            detail: "",
          }),
      },
    ];
    const results = await runChecks(checks);
    assertEquals(results.length, 2);
    assertEquals(results[0].status, "fail");
    assertStringIncludes(results[0].detail, "BOOM");
    assertEquals(results[1].status, "pass");
  },
);

Deno.test(
  "runChecks: non-Error throw produces fail with stringified detail",
  async () => {
    const checks: Check[] = [
      {
        id: "a",
        description: "Throws string",
        run: () => Promise.reject("oops"),
      },
    ];
    const results = await runChecks(checks);
    assertEquals(results[0].status, "fail");
    assertStringIncludes(results[0].detail, "oops");
  },
);
