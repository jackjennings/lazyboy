import { parse } from "@std/toml";
import { join } from "@std/path";
import type { Config, PhaseModelConfig } from "./state/types.ts";

export async function loadConfig(path?: string): Promise<Config> {
  const configPath = path ??
    join(Deno.env.get("HOME")!, ".config", "lazyboy", "config.toml");
  const raw = await Deno.readTextFile(configPath);
  const parsed = parse(raw) as Record<string, unknown>;
  const codebaseRaw = parsed.codebase as Record<string, unknown> | undefined;
  const packagesRaw = parsed.packages as Record<string, unknown> | undefined;
  const enabledRaw = packagesRaw?.enabled;
  if (enabledRaw !== undefined && !Array.isArray(enabledRaw)) {
    throw new Error("config.toml: [packages].enabled must be an array");
  }
  const jiraRaw = parsed.jira as Record<string, unknown> | undefined;
  let jira: Config["jira"];
  if (jiraRaw !== undefined) {
    if (typeof jiraRaw.base_url !== "string") {
      throw new Error("config.toml: [jira].base_url is required");
    }
    if (typeof jiraRaw.project !== "string") {
      throw new Error("config.toml: [jira].project is required");
    }
    jira = { baseUrl: jiraRaw.base_url, project: jiraRaw.project };
  }
  const piRaw = parsed.pi as Record<string, unknown> | undefined;
  if (piRaw?.provider !== undefined && typeof piRaw.provider !== "string") {
    throw new Error("config.toml: [pi].provider must be a string");
  }
  const piProvider = (piRaw?.provider as string | undefined) ?? "anthropic";
  const agentRaw = parsed.agent as Record<string, unknown> | undefined;
  if (
    agentRaw?.type !== undefined && typeof agentRaw.type !== "string"
  ) {
    throw new Error("config.toml: [agent].type must be a string");
  }
  const agentType = (agentRaw?.type as "pi" | "claude-code" | undefined) ??
    "pi";
  const phasesRaw = parsed.phases as
    | { defaults?: Record<string, unknown> }
    | undefined;
  const phasesDefaults = phasesRaw?.defaults as PhaseModelConfig | undefined;

  const tickRaw = parsed.tick as Record<string, unknown> | undefined;
  const resolveCIFailuresRaw = tickRaw?.resolve_ci_failures;
  if (
    resolveCIFailuresRaw !== undefined &&
    typeof resolveCIFailuresRaw !== "boolean"
  ) {
    throw new Error(
      "config.toml: [tick].resolve_ci_failures must be a boolean",
    );
  }

  const githubRaw = parsed.github as Record<string, unknown>;
  const accountsRaw = githubRaw.accounts as
    | Record<string, Record<string, unknown>>
    | undefined;
  let accounts: Config["github"]["accounts"];
  if (accountsRaw !== undefined) {
    accounts = {};
    for (const [name, entry] of Object.entries(accountsRaw)) {
      if (typeof entry.token_env !== "string") {
        throw new Error(
          `config.toml: [github.accounts.${name}].token_env must be a string`,
        );
      }
      if (typeof entry.login !== "string") {
        throw new Error(
          `config.toml: [github.accounts.${name}].login must be a string`,
        );
      }
      const envVal = Deno.env.get(entry.token_env);
      if (!envVal) {
        throw new Error(
          `config.toml: [github.accounts.${name}].token_env "${entry.token_env}" is not set`,
        );
      }
      accounts[name] = { tokenEnv: entry.token_env, login: entry.login };
    }
  }
  const orgsRaw = githubRaw.orgs as Record<string, string> | undefined;
  let orgs: Config["github"]["orgs"];
  if (orgsRaw !== undefined) {
    orgs = {};
    for (const [org, accountName] of Object.entries(orgsRaw)) {
      if (accounts && !accounts[accountName]) {
        throw new Error(
          `config.toml: [github.orgs] references unknown account "${accountName}"`,
        );
      }
      orgs[org] = accountName;
    }
  }

  return {
    github: {
      repos: githubRaw.repos as string[],
      accounts,
      orgs,
    },
    state: {
      dir: expandHome((parsed.state as Record<string, unknown>).dir as string),
    },
    tick: {
      concurrency: (tickRaw?.concurrency as number) ?? 1,
      resolveCIFailures: (resolveCIFailuresRaw as boolean | undefined) ?? true,
    },
    codebase: { roots: (codebaseRaw?.roots as string[]) ?? [] },
    packages: { enabled: (enabledRaw as string[] | undefined) ?? [] },
    pi: { provider: piProvider },
    agent: { type: agentType },
    jira,
    phases: phasesDefaults !== undefined
      ? { defaults: phasesDefaults }
      : undefined,
  };
}

export function expandHome(p: string): string {
  return p.startsWith("~/") ? join(Deno.env.get("HOME")!, p.slice(2)) : p;
}
