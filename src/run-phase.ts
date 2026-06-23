import { VM, RealFSProvider, createHttpHooks } from "gondolin";
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
  ? JSON.parse(args["worktrees"]) as Record<string, { path: string; branch: string }>
  : {};

const githubToken = Deno.env.get("GITHUB_TOKEN") ?? "";
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const vfsMounts: Record<string, InstanceType<typeof RealFSProvider>> = {
  "/ticket": new RealFSProvider(ticketDir),
};
for (const dir of scopeDirs) {
  const guestPath = `/scope/${dir.split("/").pop()}`;
  vfsMounts[guestPath] = new RealFSProvider(dir);
}
for (const [slug, info] of Object.entries(worktrees)) {
  vfsMounts[`/workspace/${slug}`] = new RealFSProvider(info.path);
}

const { httpHooks, env } = createHttpHooks({
  allowedHosts: ["api.anthropic.com", "api.github.com"],
  secrets: {
    GITHUB_TOKEN: { hosts: ["api.github.com"], value: githubToken },
    ANTHROPIC_API_KEY: { hosts: ["api.anthropic.com"], value: anthropicApiKey },
  },
});

const vm = await VM.create({
  httpHooks,
  env,
  vfs: { mounts: vfsMounts },
});

const contextFiles = ["@/ticket/meta.md"];
if (scopeDirs.length > 0) contextFiles.push("@/scope");

const result = await vm.exec(
  `pi -p "${prompt}" ${contextFiles.join(" ")}`
);

await Deno.writeTextFile(join(ticketDir, outputFile), result.stdout);
await vm.close();
Deno.exit(result.exitCode);
