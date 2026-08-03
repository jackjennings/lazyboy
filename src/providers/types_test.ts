import { assertEquals, assertGreater, assertLess } from "@std/assert";
import { compareSortKeys } from "./types.ts";

Deno.test("compareSortKeys: two numbers, smaller first", () => {
  assertLess(compareSortKeys([3], [12]), 0);
});

Deno.test("compareSortKeys: two numbers, larger first", () => {
  assertGreater(compareSortKeys([12], [3]), 0);
});

Deno.test("compareSortKeys: two equal numbers", () => {
  assertEquals(compareSortKeys([3], [3]), 0);
});

Deno.test("compareSortKeys: two strings, lexicographic", () => {
  assertLess(compareSortKeys(["a"], ["b"]), 0);
});

Deno.test("compareSortKeys: shorter prefix sorts before longer", () => {
  assertLess(compareSortKeys(["gh"], ["gh", 1]), 0);
});

Deno.test("compareSortKeys: string sorts before number at same position", () => {
  assertLess(compareSortKeys(["a"], [1]), 0);
});
