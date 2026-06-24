import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";

const args = parseArgs(Deno.args, {
  string: ["ticket-dir", "output-file", "scope", "prompt", "worktrees"],
});

const ticketDir = args["ticket-dir"]!;
const outputFile = args["output-file"]!;
const scopeDirs = args["scope"] ? args["scope"].split(",").filter(Boolean) : [];
const prompt = args["prompt"]!;
const worktrees = args["worktrees"]
  ? (JSON.parse(args["worktrees"]) as Record<
      string,
      { path: string; branch: string }
    >)
  : {};

const contextFiles = [`@${ticketDir}/meta.md`];
for (const file of ["intake.md", "enrichment.md", "spec.md", "plan.md"]) {
  try {
    await Deno.stat(`${ticketDir}/${file}`);
    contextFiles.push(`@${ticketDir}/${file}`);
  } catch { /* not yet written */ }
}

const allPaths = [...scopeDirs, ...Object.values(worktrees).map((w) => w.path)];
const pathContext = `\n\nTicket directory: ${ticketDir}` +
  (allPaths.length > 0 ? `\n\nAvailable directories:\n${allPaths.map((p) => `- ${p}`).join("\n")}` : "");

const worktreePaths = Object.values(worktrees).map((w) => w.path);
const cwd = worktreePaths[0] ?? ticketDir;

const result = await new Deno.Command("pi", {
  args: [
    "-p",
    "--provider",
    "anthropic",
    "--model",
    "claude-haiku-4-5-20251001",
    "--system-prompt",
    prompt + pathContext,
    ...contextFiles,
  ],
  cwd,
  env: {
    ...Deno.env.toObject(),
    ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  },
  stdout: "piped",
  stderr: "inherit",
}).output();

await Deno.writeTextFile(
  join(ticketDir, outputFile),
  new TextDecoder().decode(result.stdout),
);
Deno.exit(result.code);
