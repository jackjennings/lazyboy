import { commands } from "./commands/registry.ts";

try {
  const content = await Deno.readTextFile(
    `${Deno.env.get("HOME")}/.config/lazyboy/env`,
  );
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (Deno.env.get(key) === undefined) {
      Deno.env.set(key, value);
    }
  }
} catch (err) {
  if (!(err instanceof Deno.errors.NotFound)) {
    throw err;
  }
}

const publicCommands = commands
  .filter((c) => !c.name.startsWith("_"))
  .sort((a, b) => a.name.localeCompare(b.name));

if (Deno.args[0] === "--help") {
  const usage = publicCommands.map((c) => c.name).join("|");
  const maxLen = Math.max(...publicCommands.map((c) => c.name.length));
  const rows = publicCommands
    .map((c) => `  ${c.name.padEnd(maxLen)}  ${c.description ?? ""}`.trimEnd())
    .join("\n");
  console.log(`Usage: lazyboy <${usage}>\n\nCommands:\n${rows}`);
  Deno.exit(0);
}

const name = Deno.args[0];
const command = commands.find((c) => c.name === name);

if (!command) {
  const usage = publicCommands.map((c) => c.name).join("|");
  console.error(`Usage: lazyboy <${usage}>`);
  Deno.exit(1);
}

if (Deno.args[1] === "--help") {
  const parts: string[] = [];
  if (command.usage) parts.push(`Usage: ${command.usage}`);
  if (command.description) parts.push(command.description);
  console.log(parts.join("\n\n"));
  Deno.exit(0);
}

await command.run(Deno.args.slice(1));
