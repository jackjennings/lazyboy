import { existsSync } from "@std/fs";
import { join } from "@std/path";
import {
  appendTicketLog,
  commitState,
  listTickets,
  readTicket,
  writePhaseOutput,
  writeTicket,
} from "./state/store.ts";
import { expandHome } from "./config.ts";
import { GitHubProvider } from "./providers/github.ts";
import { JiraProvider } from "./providers/jira.ts";
import type { Provider } from "./providers/types.ts";
import { jiraPickupAction } from "./tick-actions/jira-pickup.ts";
import { jiraDoneAction } from "./tick-actions/jira-done.ts";
import { isPhaseAlive, spawnPhase } from "./executor.ts";
import {
  cloneRemoteRepo,
  createWorktree,
  findLocalRepo,
  formatRepoCorpus,
  listRepoCorpus,
  runGit,
} from "./worktree.ts";
import { createWorktreeAction } from "./tick-actions/create-worktree.ts";
import { checkMergedPRAction } from "./tick-actions/check-merged-pr.ts";
import {
  checkConflictsAction,
  sanitizeBranchForFilename,
} from "./tick-actions/check-conflicts.ts";
import { resolveConflictsAction } from "./tick-actions/resolve-conflicts.ts";
import {
  installPackages,
  isPackageInstalled,
  runPiInstall,
} from "./packages.ts";
import { createMigrationRunner } from "./migrations/runner.ts";
import type { Migration } from "./migrations/types.ts";
import {
  appendTickLog,
  resolvePhaseModel,
  type TickServiceDeps,
} from "./tick.ts";
import { PidFileLock } from "./lock.ts";
import { selfReview } from "./self-review.ts";
import { refreshAnthropicPricingIfStale } from "./anthropic-pricing.ts";
import type { Config } from "./state/types.ts";

async function ensureRunPidGitignored(stateDir: string): Promise<void> {
  const gitignorePath = join(stateDir, ".gitignore");
  let content = "";
  try {
    content = await Deno.readTextFile(gitignorePath);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const lines = content.split("\n");
  if (lines.some((l) => l.trim() === "run.pid")) return;
  await Deno.writeTextFile(
    gitignorePath,
    content ? content + "run.pid\n" : "run.pid\n",
  );
}

export function composeTickDeps(
  config: Config,
): TickServiceDeps {
  const stateDir = expandHome(config.state.dir);
  const home = Deno.env.get("HOME")!;
  const token = Deno.env.get("GITHUB_TOKEN") ?? "";
  const login = Deno.env.get("GITHUB_LOGIN") ?? "";
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const piProvider = config.pi.provider;

  const githubProvider = new GitHubProvider({
    repos: config.github.repos,
    token,
    login,
  });

  const providers: Provider[] = [githubProvider];

  if (config.jira) {
    providers.push(
      new JiraProvider({
        baseUrl: config.jira.baseUrl,
        email: Deno.env.get("JIRA_EMAIL") ?? "",
        apiToken: Deno.env.get("JIRA_API_TOKEN") ?? "",
        project: config.jira.project,
      }),
    );
  }

  const tickActions = [
    createWorktreeAction({
      roots: config.codebase.roots.map(expandHome),
      findLocalRepo,
      createWorktree,
      writeTicket,
      readIntakeOutput: async (ticketDir: string) => {
        const files: string[] = [];
        try {
          for await (const entry of Deno.readDir(ticketDir)) {
            if (
              entry.isFile &&
              /^\d{8}T\d{6}-intake\.md$/.test(entry.name)
            ) {
              files.push(entry.name);
            }
          }
        } catch {
          return null;
        }
        if (files.length === 0) return null;
        files.sort();
        return Deno.readTextFile(join(ticketDir, files[files.length - 1]));
      },
      cloneRemoteRepo: (slug: string) => cloneRemoteRepo(slug, token),
      stat: async (path: string) => {
        try {
          await Deno.stat(path);
          return true;
        } catch {
          return false;
        }
      },
    }),
    checkMergedPRAction({
      isPRMerged: async (prUrl: string) => {
        const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
        if (!match) throw new Error(`Cannot parse PR URL: ${prUrl}`);
        const [, slug, number] = match;
        const res = await fetch(
          `https://api.github.com/repos/${slug}/pulls/${number}/merge`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
            },
          },
        );
        if (res.status === 204) return true;
        if (res.status === 404) return false;
        throw new Error(
          `Unexpected GitHub API status: ${res.status} for ${prUrl}`,
        );
      },
      cleanupWorktree: async (wt) => {
        const result = await new Deno.Command("git", {
          args: ["rev-parse", "--git-common-dir"],
          cwd: wt.path,
        }).output();
        const gitDir = new TextDecoder().decode(result.stdout).trim();
        const mainRepoPath = gitDir.replace(/[/\\]\.git$/, "");
        await new Deno.Command("git", {
          args: ["worktree", "remove", wt.path],
          cwd: mainRepoPath,
        }).output();
        await new Deno.Command("git", {
          args: ["branch", "-D", wt.branch],
          cwd: mainRepoPath,
        }).output();
      },
      closeWorkItem: (url: string) => githubProvider.close(url),
      writeTicket,
      appendLog: appendTicketLog,
    }),
    resolveConflictsAction({
      runGit,
      isProcessAlive: (ticketId: string) =>
        isPhaseAlive(join(stateDir, ticketId)),
      writeTicket,
      appendLog: appendTicketLog,
      stat: async (path) => {
        try {
          const info = await Deno.stat(path);
          return { isFile: info.isFile };
        } catch {
          return null;
        }
      },
      readDir: (path) => Deno.readDir(path),
      remove: (path) => Deno.remove(path),
    }),
    checkConflictsAction({
      runGit,
      isProcessAlive: (ticketId: string) =>
        isPhaseAlive(join(stateDir, ticketId)),
      worktreeExists: existsSync,
      writeTicket,
      appendLog: appendTicketLog,
      writeContextFile: async (ticketDir, branch, content) => {
        await Deno.writeTextFile(
          join(ticketDir, `conflict-context-${branch}.md`),
          content,
        );
      },
      resolveModelConfig: (ticket) =>
        resolvePhaseModel(config, "conflict-resolution", ticket),
      spawn: (opts) => {
        const safeBranch = sanitizeBranchForFilename(opts.branch);
        const contextFilePaths = [
          `@${opts.ticketDir}/meta.md`,
          `@${opts.ticketDir}/conflict-context-${safeBranch}.md`,
        ];
        const prompt = `You are resolving git rebase conflicts. ` +
          `Examine the conflicted files listed in the context, resolve all merge conflicts, ` +
          `then run \`git rebase --continue\` until the rebase completes. ` +
          `After a successful rebase, run \`git push --force-with-lease origin ${opts.branch}\`.`;
        return spawnPhase({
          ticketDir: opts.ticketDir,
          prompt,
          scopeDirs: [],
          outputFile: "conflict-resolution.md",
          githubToken: token,
          anthropicApiKey,
          worktrees: {
            [opts.branch]: { path: opts.worktreePath, branch: opts.branch },
          },
          provider: piProvider,
          model: opts.model,
          thinking: opts.thinking,
          contextFiles: contextFilePaths,
        });
      },
    }),
    ...(config.jira
      ? [
        jiraPickupAction({
          baseUrl: config.jira.baseUrl,
          email: Deno.env.get("JIRA_EMAIL") ?? "",
          apiToken: Deno.env.get("JIRA_API_TOKEN") ?? "",
          appendLog: appendTicketLog,
        }),
        jiraDoneAction({
          baseUrl: config.jira.baseUrl,
          email: Deno.env.get("JIRA_EMAIL") ?? "",
          apiToken: Deno.env.get("JIRA_API_TOKEN") ?? "",
          writeTicket,
          appendLog: appendTicketLog,
        }),
      ]
      : []),
  ];

  const migrationsDir = new URL("../migrations", import.meta.url).pathname;
  const lastWorkedPath = join(home, ".lazyboy", "last-worked.json");

  return {
    stateDir,
    concurrency: config.tick.concurrency,
    packageSources: config.packages.enabled,
    installPackages: (sources) =>
      installPackages(sources, {
        run: runPiInstall,
        isInstalled: isPackageInstalled,
      }),
    providers,
    tickActions,
    tickDeps: {
      spawn: (opts) =>
        spawnPhase({
          ticketDir: opts.ticketDir,
          prompt: opts.prompt,
          scopeDirs: opts.scope.map(expandHome),
          outputFile: opts.outputFile,
          githubToken: token,
          anthropicApiKey,
          worktrees: opts.worktrees,
          provider: piProvider,
          model: opts.model,
          thinking: opts.thinking,
        }),
      isProcessAlive: (ticketId: string) =>
        isPhaseAlive(join(stateDir, ticketId)),
      writeTicket,
      writePhaseOutput,
      appendLog: appendTicketLog,
      resolveModelConfig: (phase, ticket) =>
        resolvePhaseModel(config, phase, ticket),
      selfReview: (phase, ticketDir) => selfReview(phase, ticketDir, fetch),
      buildRepoCorpusText: () =>
        listRepoCorpus(
          config.codebase.roots.map(expandHome),
          config.github.repos,
        )
          .then(formatRepoCorpus),
    },
    runMigrations: createMigrationRunner({
      listMigrationFiles: async () => {
        const files: string[] = [];
        try {
          for await (const entry of Deno.readDir(migrationsDir)) {
            if (entry.isFile && /^\d+-[a-z0-9-]+\.ts$/.test(entry.name)) {
              files.push(entry.name);
            }
          }
        } catch (e) {
          if (!(e instanceof Deno.errors.NotFound)) throw e;
        }
        return files.sort();
      },
      loadMigration: async (id: string): Promise<Migration> => {
        const module = await import(join(migrationsDir, id));
        return module.default;
      },
      readApplied: async (dir: string) => {
        try {
          const content = await Deno.readTextFile(join(dir, ".migrations"));
          return content.split("\n").filter((l) => l.length > 0);
        } catch (e) {
          if (e instanceof Deno.errors.NotFound) return [];
          throw e;
        }
      },
      writeApplied: (dir: string, ids: string[]) =>
        Deno.writeTextFile(join(dir, ".migrations"), ids.join("\n") + "\n"),
      writeTicket,
    }),
    readLastWorked: async () => {
      try {
        const raw = await Deno.readTextFile(lastWorkedPath);
        const parsed = JSON.parse(raw);
        if (
          !Array.isArray(parsed) ||
          !parsed.every((x) => typeof x === "string")
        ) {
          return [];
        }
        return parsed as string[];
      } catch {
        return [];
      }
    },
    writeLastWorked: (ids) =>
      Deno.writeTextFile(lastWorkedPath, JSON.stringify(ids)),
    listTickets: () => listTickets(stateDir),
    readTicket: (id) => readTicket(stateDir, id),
    writeTicket: (t) => writeTicket(stateDir, t),
    commitState: async () => {
      await ensureRunPidGitignored(stateDir);
      await commitState(stateDir, `tick: ${Temporal.Now.instant().toString()}`);
    },
    lock: new PidFileLock(join(home, ".lazyboy", "tick.pid"), {
      log: appendTickLog,
    }),
    refreshAnthropicPricing: () => refreshAnthropicPricingIfStale(home, fetch),
  };
}
