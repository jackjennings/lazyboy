import { assertEquals } from "jsr:@std/assert";
import { loadConfig, expandHome } from "./config.ts";
import { join } from "@std/path";

Deno.test("loadConfig parses toml", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "config.toml"), `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2
`);
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.github.repos, ["jackjennings/lazyboy"]);
  assertEquals(cfg.tick.concurrency, 2);
});

Deno.test("expandHome replaces ~/ with HOME", () => {
  const home = Deno.env.get("HOME")!;
  assertEquals(expandHome("~/foo/bar"), `${home}/foo/bar`);
  assertEquals(expandHome("/absolute/path"), "/absolute/path");
});

Deno.test("loadConfig parses codebase.roots", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "config.toml"), `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2

[codebase]
roots = ["~/code/myorg", "~/code/anotherg"]
`);
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.codebase.roots, ["~/code/myorg", "~/code/anotherg"]);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig defaults codebase.roots to [] when absent", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "config.toml"), `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2
`);
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.codebase.roots, []);
  await Deno.remove(dir, { recursive: true });
});
