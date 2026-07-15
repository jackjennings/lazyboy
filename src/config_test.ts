import { assertEquals, assertRejects } from "@std/assert";
import { expandHome, loadConfig } from "./config.ts";
import { join } from "@std/path";

Deno.test("loadConfig parses toml", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2
`,
  );
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
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2

[codebase]
roots = ["~/code", "~/code2"]
`,
  );
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.codebase.roots, ["~/code", "~/code2"]);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig defaults codebase.roots to [] when absent", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 2
`,
  );
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.codebase.roots, []);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig parses [packages].enabled", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 1

[packages]
enabled = ["npm:pi-lens", "agent-browser"]
`,
  );
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.packages.enabled, ["npm:pi-lens", "agent-browser"]);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig defaults packages.enabled to [] when absent", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 1
`,
  );
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.packages.enabled, []);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig throws when packages.enabled is not an array", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code/jackjennings/projects"

[tick]
concurrency = 1

[packages]
enabled = "not-an-array"
`,
  );
  await assertRejects(
    () => loadConfig(join(dir, "config.toml")),
    Error,
  );
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig parses [jira] section", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = ["jackjennings/lazyboy"]

[state]
dir = "~/code"

[tick]
concurrency = 1

[jira]
base_url = "https://myorg.atlassian.net"
project = "PROJ"
`,
  );
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.jira?.baseUrl, "https://myorg.atlassian.net");
  assertEquals(cfg.jira?.project, "PROJ");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig sets config.jira to undefined when [jira] absent", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = []

[state]
dir = "~/code"

[tick]
concurrency = 1
`,
  );
  const cfg = await loadConfig(join(dir, "config.toml"));
  assertEquals(cfg.jira, undefined);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig throws when [jira] present but base_url missing", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = []

[state]
dir = "~/code"

[tick]
concurrency = 1

[jira]
project = "PROJ"
`,
  );
  await assertRejects(
    () => loadConfig(join(dir, "config.toml")),
    Error,
    "config.toml: [jira].base_url is required",
  );
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadConfig throws when [jira] present but project missing", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "config.toml"),
    `
[github]
repos = []

[state]
dir = "~/code"

[tick]
concurrency = 1

[jira]
base_url = "https://myorg.atlassian.net"
`,
  );
  await assertRejects(
    () => loadConfig(join(dir, "config.toml")),
    Error,
    "config.toml: [jira].project is required",
  );
  await Deno.remove(dir, { recursive: true });
});
