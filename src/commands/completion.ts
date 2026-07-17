import type { Command } from "./types.ts";

export const completion: Command = {
  name: "completion",
  description: "print shell completion script",
  completesWith: ["zsh"],
  async run(args) {
    const shell = args[0];
    if (!shell) {
      console.error("Usage: lazyboy completion <zsh>");
      Deno.exit(1);
    }
    if (shell !== "zsh") {
      console.error(`Unsupported shell: ${shell}`);
      Deno.exit(1);
    }
    const scriptPath = new URL(
      `../completion.${shell}`,
      import.meta.url,
    ).pathname;
    console.log(await Deno.readTextFile(scriptPath));
  },
};
