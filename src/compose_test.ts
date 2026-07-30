import { assertEquals } from "@std/assert";
import { ensureStatePrompts, resolveGitHubAccount } from "./compose.ts";
import { PHASE_SEQUENCE } from "./phases/types.ts";
import { join } from "@std/path";
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

Deno.test(
  "ensureStatePrompts: creates prompts dir and all phase files when absent",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await ensureStatePrompts(stateDir);
      for (const phase of PHASE_SEQUENCE) {
        const content = await Deno.readTextFile(
          join(stateDir, "prompts", `${phase}.md`),
        );
        assertEquals(content, "");
      }
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "ensureStatePrompts: no-op when all files already exist",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(stateDir, "prompts"), { recursive: true });
      for (const phase of PHASE_SEQUENCE) {
        await Deno.writeTextFile(join(stateDir, "prompts", `${phase}.md`), "");
      }
      const before = await Deno.stat(join(stateDir, "prompts", "intake.md"));
      await ensureStatePrompts(stateDir);
      const after = await Deno.stat(join(stateDir, "prompts", "intake.md"));
      assertEquals(before.mtime?.getTime(), after.mtime?.getTime());
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "ensureStatePrompts: creates only missing files, leaves existing untouched",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(stateDir, "prompts"), { recursive: true });
      await Deno.writeTextFile(
        join(stateDir, "prompts", "intake.md"),
        "existing content",
      );
      await ensureStatePrompts(stateDir);
      assertEquals(
        await Deno.readTextFile(join(stateDir, "prompts", "intake.md")),
        "existing content",
      );
      for (const phase of PHASE_SEQUENCE.filter((p) => p !== "intake")) {
        assertEquals(
          await Deno.readTextFile(join(stateDir, "prompts", `${phase}.md`)),
          "",
        );
      }
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "ensureStatePrompts: created files are empty (zero bytes)",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await ensureStatePrompts(stateDir);
      for (const phase of PHASE_SEQUENCE) {
        const stat = await Deno.stat(
          join(stateDir, "prompts", `${phase}.md`),
        );
        assertEquals(stat.size, 0);
      }
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "ensureStatePrompts: phases come from PHASE_SEQUENCE, not hardcoded list",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await ensureStatePrompts(stateDir);
      const entries: string[] = [];
      for await (const entry of Deno.readDir(join(stateDir, "prompts"))) {
        entries.push(entry.name);
      }
      assertEquals(
        entries.sort(),
        PHASE_SEQUENCE.map((p) => `${p}.md`).sort(),
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);
