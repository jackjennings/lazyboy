import { assertEquals, assertStringIncludes } from "@std/assert";

const plugin = await Deno.readTextFile(
  new URL("../plugin/urras.plugin.zsh", import.meta.url),
);

const EXPECTED_ALIASES: [string, string][] = [
  ["utk", "tick"],
  ["uap", "approve"],
  ["ust", "status"],
  ["uen", "enable"],
  ["udi", "disable"],
  ["uco", "completion"],
  ["urt", "retry"],
  ["udc", "decline"],
  ["urv", "review"],
  ["ush", "shell"],
  ["uta", "tail"],
  ["uup", "update"],
  ["uhd", "hud"],
  ["uus", "usage"],
];

const ID_ALIASES = ["uap", "urt", "udc", "urv", "ush", "uta"];

Deno.test("all 14 aliases are declared", () => {
  for (const [alias, subcommand] of EXPECTED_ALIASES) {
    const line = `alias ${alias}='ur ${subcommand}'`;
    assertStringIncludes(plugin, line, `missing: ${line}`);
  }
});

Deno.test("all aliases are exactly 3 characters starting with u", () => {
  for (const [alias] of EXPECTED_ALIASES) {
    assertEquals(alias.length, 3, `${alias} is not 3 chars`);
    assertEquals(alias[0], "u", `${alias} does not start with u`);
  }
});

Deno.test("no duplicate aliases", () => {
  const aliases = EXPECTED_ALIASES.map(([a]) => a);
  assertEquals(new Set(aliases).size, aliases.length);
});

Deno.test("plugin sources ur completion zsh", () => {
  assertStringIncludes(plugin, "source <(ur completion zsh)");
});

Deno.test("compdef registered for all 6 ID-taking aliases", () => {
  for (const alias of ID_ALIASES) {
    const line = `compdef ${alias}=ur`;
    assertStringIncludes(plugin, line, `missing: ${line}`);
  }
});
