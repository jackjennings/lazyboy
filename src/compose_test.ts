import { assertEquals } from "@std/assert";
import { resolveGitHubAccount } from "./compose.ts";
import type { Config } from "./state/types.ts";

function makeConfig(overrides: Partial<Config["github"]> = {}): Config {
  return {
    github: { repos: [], ...overrides },
    state: { dir: "/tmp" },
    tick: { concurrency: 1, resolveCIFailures: true, principles: true },
    codebase: { roots: [] },
    packages: { enabled: [] },
    pi: { provider: "anthropic" },
    agent: { type: "pi" },
  };
}

Deno.test("resolveGitHubAccount: accounts absent falls back to GITHUB_TOKEN/GITHUB_LOGIN", () => {
  Deno.env.set("GITHUB_TOKEN", "tok_fallback");
  Deno.env.set("GITHUB_LOGIN", "login_fallback");
  const result = resolveGitHubAccount("anyorg", makeConfig());
  assertEquals(result.token, "tok_fallback");
  assertEquals(result.login, "login_fallback");
});

Deno.test("resolveGitHubAccount: accounts present, org mapped → returns account creds", () => {
  Deno.env.set("GITHUB_TOKEN_PERSONAL", "tok_personal");
  const cfg = makeConfig({
    accounts: {
      personal: { tokenEnv: "GITHUB_TOKEN_PERSONAL", login: "jackjennings" },
    },
    orgs: { jackjennings: "personal" },
  });
  const result = resolveGitHubAccount("jackjennings", cfg);
  assertEquals(result.token, "tok_personal");
  assertEquals(result.login, "jackjennings");
});

Deno.test("resolveGitHubAccount: accounts present, org not in orgs → falls back to GITHUB_TOKEN/GITHUB_LOGIN", () => {
  Deno.env.set("GITHUB_TOKEN", "tok_fallback");
  Deno.env.set("GITHUB_LOGIN", "login_fallback");
  Deno.env.set("GITHUB_TOKEN_PERSONAL", "tok_personal");
  const cfg = makeConfig({
    accounts: {
      personal: { tokenEnv: "GITHUB_TOKEN_PERSONAL", login: "jackjennings" },
    },
    orgs: { jackjennings: "personal" },
  });
  const result = resolveGitHubAccount("unknownorg", cfg);
  assertEquals(result.token, "tok_fallback");
  assertEquals(result.login, "login_fallback");
});
