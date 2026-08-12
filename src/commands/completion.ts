import type { Command } from "./types.ts";
import { readTextFile } from "../filesystem.ts";

export const completion: Command = {
  name: "completion",
  description: "print shell completion script",
  usage: "lazyboy completion <zsh>",
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
    console.log(await readTextFile(scriptPath));
  },
};
