import { assertEquals } from "@std/assert";

const plugin = await Deno.readTextFile(
  new URL("../plugin/lazyboy.plugin.zsh", import.meta.url),
);

const EXPECTED_ALIASES: [string, string][] = [
  ["ltk", "tick"],
  ["lap", "approve"],
  ["lst", "status"],
  ["len", "enable"],
  ["ldi", "disable"],
  ["lco", "completion"],
  ["lrt", "retry"],
  ["ldc", "decline"],
  ["lrv", "review"],
  ["lsh", "shell"],
  ["lta", "tail"],
  ["lup", "update"],
];

const ID_ALIASES = ["lap", "lrt", "ldc", "lrv", "lsh", "lta"];

Deno.test("all 12 aliases are declared", () => {
  for (const [alias, subcommand] of EXPECTED_ALIASES) {
    const line = `alias ${alias}='lazyboy ${subcommand}'`;
    assertEquals(plugin.includes(line), true, `missing: ${line}`);
  }
});

Deno.test("all aliases are exactly 3 characters starting with l", () => {
  for (const [alias] of EXPECTED_ALIASES) {
    assertEquals(alias.length, 3, `${alias} is not 3 chars`);
    assertEquals(alias[0], "l", `${alias} does not start with l`);
  }
});

Deno.test("no duplicate aliases", () => {
  const aliases = EXPECTED_ALIASES.map(([a]) => a);
  assertEquals(new Set(aliases).size, aliases.length);
});

Deno.test("plugin sources lazyboy completion zsh", () => {
  assertEquals(plugin.includes("source <(lazyboy completion zsh)"), true);
});

Deno.test("compdef registered for all 6 ID-taking aliases", () => {
  for (const alias of ID_ALIASES) {
    const line = `compdef ${alias}=lazyboy`;
    assertEquals(plugin.includes(line), true, `missing: ${line}`);
  }
});
