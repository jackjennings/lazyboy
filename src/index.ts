import { commands } from "./commands/registry.ts";

const name = Deno.args[0];
const command = commands.find((c) => c.name === name);

if (!command) {
  const usage = commands
    .map((c) => c.name)
    .filter((n) => !n.startsWith("_"))
    .sort()
    .join("|");
  console.error(`Usage: lazyboy <${usage}>`);
  Deno.exit(1);
}

await command.run(Deno.args.slice(1));
