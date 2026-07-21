import { assertEquals } from "@std/assert";
import { compareSortKeys } from "./types.ts";

Deno.test("compareSortKeys: two numbers, smaller first", () => {
  assertEquals(compareSortKeys([3], [12]) < 0, true);
});

Deno.test("compareSortKeys: two numbers, larger first", () => {
  assertEquals(compareSortKeys([12], [3]) > 0, true);
});

Deno.test("compareSortKeys: two equal numbers", () => {
  assertEquals(compareSortKeys([3], [3]), 0);
});

Deno.test("compareSortKeys: two strings, lexicographic", () => {
  assertEquals(compareSortKeys(["a"], ["b"]) < 0, true);
});

Deno.test("compareSortKeys: shorter prefix sorts before longer", () => {
  assertEquals(compareSortKeys(["gh"], ["gh", 1]) < 0, true);
});

Deno.test("compareSortKeys: string sorts before number at same position", () => {
  assertEquals(compareSortKeys(["a"], [1]) < 0, true);
});
