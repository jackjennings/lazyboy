import { assertEquals } from "@std/assert";
import { isPidAlive } from "./executor.ts";

Deno.test("isPidAlive returns true for current process", () => {
  assertEquals(isPidAlive(Deno.pid), true);
});

Deno.test("isPidAlive returns false for dead PID", () => {
  assertEquals(isPidAlive(99999999), false);
});
