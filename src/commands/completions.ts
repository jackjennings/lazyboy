import type { Command } from "./types.ts";

export function formatCompletions(commands: Command[]): string {
  return commands
    .filter((c) => !c.name.startsWith("_"))
    .map((c) => {
      const completesWith = Array.isArray(c.completesWith)
        ? c.completesWith.join(",")
        : c.completesWith ?? "";
      return `${c.name}\t${c.description ?? ""}\t${completesWith}`;
    })
    .join("\n");
}

export const completions: Command = {
  name: "_completions",
  async run(_args) {
    const { commands } = await import("./registry.ts");
    console.log(formatCompletions(commands));
  },
};
