import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { join } from "@std/path";

function runIndex(args: string[], env?: Record<string, string>) {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      new URL("./index.ts", import.meta.url).pathname,
      ...args,
    ],
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  });
  return cmd.output();
}

Deno.test("completion zsh: exits 0", async () => {
  const result = await runIndex(["completion", "zsh"]);
  assertEquals(result.code, 0);
});

Deno.test("completion zsh: output begins with #compdef lazyboy", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertEquals(stdout.startsWith("#compdef lazyboy"), true);
});

Deno.test("completion zsh: defines and registers _lazyboy", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertStringIncludes(stdout, "_lazyboy()");
  assertStringIncludes(stdout, "compdef _lazyboy lazyboy");
});

Deno.test("completion zsh: offers all six subcommands", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  for (
    const cmd of [
      "tick",
      "approve",
      "status",
      "enable",
      "disable",
      "completion",
    ]
  ) {
    assertStringIncludes(stdout, cmd);
  }
});

Deno.test("completion zsh: approve completion calls lazyboy _ids", async () => {
  const result = await runIndex(["completion", "zsh"]);
  const stdout = new TextDecoder().decode(result.stdout);
  assertStringIncludes(stdout, "lazyboy _ids 2>/dev/null");
});

Deno.test(
  "completion zsh: completion subcommand completion offers zsh",
  async () => {
    const result = await runIndex(["completion", "zsh"]);
    const stdout = new TextDecoder().decode(result.stdout);
    assertStringIncludes(stdout, "compadd -- zsh");
  },
);

Deno.test(
  "completion zsh: _ids not listed as a completion candidate",
  async () => {
    const result = await runIndex(["completion", "zsh"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const commandsBlock = stdout.match(/commands=\(([\s\S]*?)\)/)?.[1] ?? "";
    assertEquals(commandsBlock.includes("_ids"), false);
  },
);

Deno.test("completion alone: exits 1 with usage on stderr", async () => {
  const result = await runIndex(["completion"]);
  assertEquals(result.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(result.stderr),
    "Usage: lazyboy completion <zsh>",
  );
});

Deno.test(
  "completion bash: exits 1 with unsupported shell on stderr",
  async () => {
    const result = await runIndex(["completion", "bash"]);
    assertEquals(result.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(result.stderr),
      "Unsupported shell: bash",
    );
  },
);

async function makeFakeHome(stateDir: string): Promise<string> {
  const home = await Deno.makeTempDir();
  const configDir = join(home, ".config", "lazyboy");
  await Deno.mkdir(configDir, { recursive: true });
  await Deno.writeTextFile(
    join(configDir, "config.toml"),
    `
[github]
repos = ["jackjennings/lazyboy"]
[state]
dir = "${stateDir}"
[tick]
concurrency = 1
`,
  );
  return home;
}

Deno.test("_ids: prints one ticket ID per line and exits 0", async () => {
  const stateDir = await Deno.makeTempDir();
  await Deno.mkdir(join(stateDir, "gh-1"));
  await Deno.mkdir(join(stateDir, "gh-2"));
  const home = await makeFakeHome(stateDir);
  try {
    const result = await runIndex(["_ids"], { HOME: home });
    assertEquals(result.code, 0);
    const lines = new TextDecoder().decode(result.stdout)
      .trim()
      .split("\n")
      .sort();
    assertEquals(lines, ["gh-1", "gh-2"]);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test(
  "_ids: empty output and exits 0 when state dir does not exist",
  async () => {
    const home = await makeFakeHome("/nonexistent/lazyboy-state-dir");
    try {
      const result = await runIndex(["_ids"], { HOME: home });
      assertEquals(result.code, 0);
      assertEquals(new TextDecoder().decode(result.stdout).trim(), "");
    } finally {
      await Deno.remove(home, { recursive: true });
    }
  },
);
