import type { Command } from "./types.ts";

export function formatGlobalHelp(commands: Command[]): string {
  const publicCommands = commands
    .filter((c) => !c.name.startsWith("_"))
    .sort((a, b) => a.name.localeCompare(b.name));
  const usage = publicCommands.map((c) => c.name).join("|");
  const maxLen = Math.max(...publicCommands.map((c) => c.name.length));
  const rows = publicCommands
    .map((c) => `  ${c.name.padEnd(maxLen)}  ${c.description ?? ""}`.trimEnd())
    .join("\n");
  return `Usage: ur <${usage}>\n\nCommands:\n${rows}`;
}

export function formatCommandHelp(command: Command): string {
  const parts: string[] = [];
  if (command.usage) parts.push(`Usage: ${command.usage}`);
  if (command.description) parts.push(command.description);
  return parts.join("\n\n");
}
