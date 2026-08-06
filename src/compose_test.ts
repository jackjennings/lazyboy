import { assertEquals } from "@std/assert";
import {
  deriveOrgFromTicketDir,
  ensureStatePrompts,
  resolveGitHubAccount,
} from "./compose.ts";
import { PHASE_SEQUENCE } from "./phases/types.ts";
import { join } from "@std/path";
import type { Config } from "./state/types.ts";

function makeConfig(overrides: Partial<Config["github"]> = {}): Config {
  return {
    github: { repos: [], ...overrides },
    state: { dir: "/tmp" },
    tick: {
      concurrency: 1,
      resolveCIFailures: true,
      principles: true,
      agentsMdMaxTokens: 8000,
    },
    codebase: { roots: [] },
    packages: { enabled: [] },
    pi: { provider: "anthropic" },
    agent: { type: "pi" },
  };
}

Deno.test("deriveOrgFromTicketDir: github ticket returns org segment", () => {
  assertEquals(
    deriveOrgFromTicketDir("/state/github/jackjennings/lazyboy/289", "/state"),
    "jackjennings",
  );
});

Deno.test("deriveOrgFromTicketDir: jira ticket returns empty string", () => {
  assertEquals(
    deriveOrgFromTicketDir("/state/jira/PROJ-123", "/state"),
    "",
  );
});

Deno.test("deriveOrgFromTicketDir: github ticket missing repo segment returns empty string", () => {
  assertEquals(
    deriveOrgFromTicketDir("/state/github", "/state"),
    "",
  );
});

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

Deno.test(
  "ensureStatePrompts: creates github repo subdirectory with phase files",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await ensureStatePrompts(stateDir, ["jackjennings/lazyboy"]);
      for (const phase of PHASE_SEQUENCE) {
        const content = await Deno.readTextFile(
          join(
            stateDir,
            "prompts",
            "github",
            "jackjennings",
            "lazyboy",
            `${phase}.md`,
          ),
        );
        assertEquals(content, "");
      }
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "ensureStatePrompts: creates jira board subdirectory with phase files",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await ensureStatePrompts(stateDir, [], "FOO");
      for (const phase of PHASE_SEQUENCE) {
        const content = await Deno.readTextFile(
          join(stateDir, "prompts", "jira", "FOO", `${phase}.md`),
        );
        assertEquals(content, "");
      }
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "ensureStatePrompts: scaffolds multiple github repos independently",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await ensureStatePrompts(stateDir, [
        "jackjennings/lazyboy",
        "jackjennings/other",
      ]);
      for (const repo of ["lazyboy", "other"]) {
        const content = await Deno.readTextFile(
          join(
            stateDir,
            "prompts",
            "github",
            "jackjennings",
            repo,
            "intake.md",
          ),
        );
        assertEquals(content, "");
      }
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "ensureStatePrompts: does not overwrite existing files in subdirectories",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(
        join(stateDir, "prompts", "github", "jackjennings", "lazyboy"),
        { recursive: true },
      );
      await Deno.writeTextFile(
        join(
          stateDir,
          "prompts",
          "github",
          "jackjennings",
          "lazyboy",
          "spec.md",
        ),
        "existing",
      );
      await ensureStatePrompts(stateDir, ["jackjennings/lazyboy"]);
      assertEquals(
        await Deno.readTextFile(
          join(
            stateDir,
            "prompts",
            "github",
            "jackjennings",
            "lazyboy",
            "spec.md",
          ),
        ),
        "existing",
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);

Deno.test(
  "ensureStatePrompts: empty repos list and no jira creates no subdirectories",
  async () => {
    const stateDir = await Deno.makeTempDir();
    try {
      await ensureStatePrompts(stateDir, []);
      const entries: string[] = [];
      for await (const entry of Deno.readDir(join(stateDir, "prompts"))) {
        if (entry.isDirectory) entries.push(entry.name);
      }
      assertEquals(entries, []);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  },
);
