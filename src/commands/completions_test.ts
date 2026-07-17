import { assertEquals } from "@std/assert";
import { formatCompletions } from "./completions.ts";
import type { Command } from "./types.ts";

function cmd(overrides: Partial<Command> & { name: string }): Command {
  return { run: async () => {}, ...overrides };
}

Deno.test("formatCompletions: formats name, description, and completesWith as tab-separated line", () => {
  const result = formatCompletions([
    cmd({
      name: "approve",
      description: "approve the phase gate",
      completesWith: "_ids",
    }),
  ]);
  assertEquals(result, "approve\tapprove the phase gate\t_ids");
});

Deno.test("formatCompletions: joins a string[] completesWith with commas", () => {
  const result = formatCompletions([
    cmd({
      name: "completion",
      description: "print completion script",
      completesWith: ["zsh"],
    }),
  ]);
  assertEquals(result, "completion\tprint completion script\tzsh");
});

Deno.test("formatCompletions: renders missing completesWith as an empty field", () => {
  const result = formatCompletions([
    cmd({ name: "tick", description: "advance all active tickets" }),
  ]);
  assertEquals(result, "tick\tadvance all active tickets\t");
});

Deno.test("formatCompletions: renders missing description as an empty field", () => {
  const result = formatCompletions([
    cmd({ name: "tick" }),
  ]);
  assertEquals(result, "tick\t\t");
});

Deno.test("formatCompletions: excludes commands whose name starts with an underscore", () => {
  const result = formatCompletions([
    cmd({ name: "tick", description: "advance all active tickets" }),
    cmd({ name: "_ids" }),
    cmd({ name: "_completions" }),
  ]);
  assertEquals(result, "tick\tadvance all active tickets\t");
});

Deno.test("formatCompletions: joins multiple commands with newlines", () => {
  const result = formatCompletions([
    cmd({ name: "tick", description: "advance all active tickets" }),
    cmd({
      name: "approve",
      description: "approve the phase gate",
      completesWith: "_ids",
    }),
  ]);
  assertEquals(
    result,
    "tick\tadvance all active tickets\t\napprove\tapprove the phase gate\t_ids",
  );
});

Deno.test("formatCompletions: returns empty string for no commands", () => {
  assertEquals(formatCompletions([]), "");
});
