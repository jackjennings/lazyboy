import { tick } from "./commands/tick.ts";
import { approve } from "./commands/approve.ts";
import { status } from "./commands/status.ts";
import { enable } from "./commands/enable.ts";
import { disable } from "./commands/disable.ts";
import { ids } from "./commands/ids.ts";
import { completion } from "./commands/completion.ts";
import { review } from "./commands/review.ts";
import { shell } from "./commands/shell.ts";
import type { Command } from "./commands/types.ts";

const commands: Command[] = [
  tick,
  approve,
  status,
  enable,
  disable,
  ids,
  completion,
  review,
  shell,
];

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
