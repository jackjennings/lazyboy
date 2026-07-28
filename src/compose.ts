import { existsSync } from "@std/fs";
import { CeremonyRunner } from "./ceremonies.ts";
import { StandupCeremony } from "./ceremonies/standup.ts";
import { join } from "@std/path";
import { detectImplementationOutlier } from "./outlier-detection.ts";
import { compactTimestamp } from "./timestamp.ts";
import { loadPromptFile } from "./phases/runners.ts";
import {
  appendTicketLog,
  commitPrinciples,
  commitState,
  listTickets,
  readTicket,
  writePhaseOutput,
  writeTicket,
} from "./state/store.ts";
import { dedupePrinciples, extractPrinciples } from "./run-phase.ts";
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
  removeWorktree,
  runGit,
} from "./worktree.ts";
import { createWorktreeAction } from "./tick-actions/create-worktree.ts";
import { checkMergedPRAction } from "./tick-actions/check-merged-pr.ts";
import { checkConflictsAction } from "./tick-actions/check-conflicts.ts";
import { resolveConflictsAction } from "./tick-actions/resolve-conflicts.ts";
import { resolveCIFailuresAction } from "./tick-actions/resolve-ci-failures.ts";
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
import { defaultCommandRunner } from "./apfel.ts";
import { makeNotify } from "./notify.ts";
import { PidFileLock } from "./lock.ts";
import { selfReview } from "./self-review.ts";
import { findLatestPhaseOutput } from "./review.ts";
import { refreshAnthropicPricingIfStale } from "./anthropic-pricing.ts";
import type { Config } from "./state/types.ts";
import { readDir, readTextFile, remove, stat } from "./fs.ts";

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

export function resolveGitHubAccount(
  org: string,
  config: Config,
): { token: string; login: string } {
  if (!config.github.accounts) {
    return {
      token: Deno.env.get("GITHUB_TOKEN") ?? "",
      login: Deno.env.get("GITHUB_LOGIN") ?? "",
    };
  }
  const accountName = config.github.orgs?.[org];
  if (!accountName) {
    return {
      token: Deno.env.get("GITHUB_TOKEN") ?? "",
      login: Deno.env.get("GITHUB_LOGIN") ?? "",
    };
  }
  const account = config.github.accounts[accountName];
  return {
    token: Deno.env.get(account.tokenEnv) ?? "",
    login: account.login,
  };
}

export function composeTickDeps(
  config: Config,
): TickServiceDeps {
  const stateDir = expandHome(config.state.dir);
  const home = Deno.env.get("HOME")!;
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const piProvider = config.pi.provider;
  const agentType = config.agent.type;

  const githubProvider = new GitHubProvider({
    repos: config.github.repos,
    accountResolver: (org) => resolveGitHubAccount(org, config),
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
          for await (const entry of readDir(ticketDir)) {
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
        return readTextFile(join(ticketDir, files[files.length - 1]));
      },
      cloneRemoteRepo: (slug: string) =>
        cloneRemoteRepo(slug, (s, d, cwd) => githubProvider.clone(s, d, cwd)),
      stat,
      appendLog: appendTicketLog,
    }),
    checkMergedPRAction({
      isPRMerged: (url) => githubProvider.isPRMerged(url),
      cleanupWorktree: removeWorktree,
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
      stat,
      readDir,
      remove,
    }),
    checkConflictsAction({
      runGit,
      isProcessAlive: (ticketId: string) =>
        isPhaseAlive(join(stateDir, ticketId)),
      worktreeExists: existsSync,
      writeTicket,
      appendLog: appendTicketLog,
      writeContextFile: async (ticketDir, branch, content) => {
        const timestamp = compactTimestamp(
          Temporal.Now.zonedDateTimeISO("UTC"),
        );
        const filename = `${timestamp}-conflict-context-${branch}.md`;
        await Deno.writeTextFile(join(ticketDir, filename), content);
        return filename;
      },
      resolveModelConfig: (ticket) =>
        resolvePhaseModel(config, "conflict-resolution", ticket),
      spawn: (opts) => {
        const timestamp = opts.contextFile.slice(
          0,
          opts.contextFile.indexOf("-conflict-context-"),
        );
        const contextFilePaths = [
          `@${opts.ticketDir}/meta.md`,
          `@${opts.ticketDir}/${opts.contextFile}`,
        ];
        const prompt = `You are resolving git rebase conflicts. ` +
          `Examine the conflicted files listed in the context, resolve all merge conflicts, ` +
          `then run \`git rebase --continue\` until the rebase completes. ` +
          `After a successful rebase, run \`git push --force-with-lease origin ${opts.branch}\`.`;
        return spawnPhase({
          ticketDir: opts.ticketDir,
          stateDir,
          prompt,
          scopeDirs: [],
          outputFile: `${timestamp}-conflict-resolution.md`,
          githubToken: resolveGitHubAccount(
            opts.branch.split("/")[1],
            config,
          ).token,
          anthropicApiKey,
          worktrees: {
            [opts.branch]: { path: opts.worktreePath, branch: opts.branch },
          },
          provider: piProvider,
          agent: agentType,
          model: opts.model,
          thinking: opts.thinking,
          contextFiles: contextFilePaths,
        });
      },
    }),
    resolveCIFailuresAction({
      getPRChecks: async (prUrl) => {
        const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
        if (!m) return null;
        const [, repoSlug, prNumber] = m;
        const { token } = resolveGitHubAccount(repoSlug.split("/")[0], config);
        const prRes = await fetch(
          `https://api.github.com/repos/${repoSlug}/pulls/${prNumber}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
            },
          },
        );
        if (!prRes.ok) throw new Error(`GitHub API ${prRes.status}`);
        const prData = await prRes.json();
        const headSha: string = prData.head.sha;
        const suiteRes = await fetch(
          `https://api.github.com/repos/${repoSlug}/commits/${headSha}/check-suites`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
            },
          },
        );
        if (!suiteRes.ok) throw new Error(`GitHub API ${suiteRes.status}`);
        const { check_suites: suites } = await suiteRes.json();
        const suite = (
          suites as Array<{ status: string; conclusion: string; id: number }>
        ).find((s) => s.status === "completed");
        if (!suite) return null;
        if (
          suite.conclusion !== "failure" &&
          suite.conclusion !== "action_required"
        ) {
          return {
            runId: String(suite.id),
            conclusion: suite.conclusion as "success" | "pending",
            firstFailingStep: "other" as const,
            failingOutput: "",
            failingFiles: [],
          };
        }
        const runsRes = await fetch(
          `https://api.github.com/repos/${repoSlug}/commits/${headSha}/check-runs`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
            },
          },
        );
        if (!runsRes.ok) throw new Error(`GitHub API ${runsRes.status}`);
        const { check_runs: runs } = await runsRes.json();
        const failing = (
          runs as Array<{
            conclusion: string;
            name: string;
            id?: number;
            output?: { text?: string };
          }>
        ).find((r) => r.conclusion === "failure");
        const stepName = failing?.name ?? "";
        const firstFailingStep = stepName.toLowerCase().includes("fmt")
          ? "fmt"
          : stepName.toLowerCase().includes("lint")
          ? "lint"
          : stepName.toLowerCase().includes("test")
          ? "test"
          : "other";
        const annotationsRes = await fetch(
          `https://api.github.com/repos/${repoSlug}/check-runs/${
            failing?.id ?? 0
          }/annotations`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
            },
          },
        ).catch(() => null);
        const failingFiles: string[] = [];
        if (annotationsRes?.ok) {
          const annotations = await annotationsRes.json();
          for (const a of annotations as Array<{ path?: string }>) {
            if (a.path) failingFiles.push(a.path);
          }
        }
        return {
          runId: String(suite.id),
          conclusion: suite.conclusion as "failure" | "action_required",
          firstFailingStep,
          failingOutput: failing?.output?.text ?? stepName,
          failingFiles,
        };
      },
      getPRDiffFiles: async (prUrl) => {
        const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
        if (!m) return [];
        const [, repoSlug, prNumber] = m;
        const { token } = resolveGitHubAccount(repoSlug.split("/")[0], config);
        const res = await fetch(
          `https://api.github.com/repos/${repoSlug}/pulls/${prNumber}/files`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
            },
          },
        );
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const files = await res.json();
        return (files as Array<{ filename: string }>).map((f) => f.filename);
      },
      runFmt: async (worktreePath) => {
        await new Deno.Command("deno", {
          args: ["fmt"],
          cwd: worktreePath,
        }).output();
        const status = await runGit(["status", "--porcelain"], worktreePath);
        return status.stdout.trim().length > 0;
      },
      runLintFix: async (worktreePath) => {
        await new Deno.Command("deno", {
          args: ["lint", "--fix"],
          cwd: worktreePath,
        }).output();
        const check = await new Deno.Command("deno", {
          args: ["lint"],
          cwd: worktreePath,
        }).output();
        const ok = check.code === 0;
        return {
          allFixed: ok,
          remainingOutput: ok ? "" : new TextDecoder().decode(check.stdout),
        };
      },
      runGit,
      createGitHubIssue: async ({ repo, title, body }) => {
        const { token, login } = resolveGitHubAccount(
          repo.split("/")[0],
          config,
        );
        const res = await fetch(
          `https://api.github.com/repos/${repo}/issues`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ title, body, assignees: [login] }),
          },
        );
        if (!res.ok) {
          throw new Error(`GitHub API ${res.status} creating issue`);
        }
      },
      readFile: async (path) => {
        try {
          return await Deno.readTextFile(path);
        } catch {
          return null;
        }
      },
      writeFile: (path, content) => Deno.writeTextFile(path, content),
      isProcessAlive: (ticketId) => isPhaseAlive(join(stateDir, ticketId)),
      writeTicket,
      appendLog: appendTicketLog,
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

  const ceremonies = new CeremonyRunner({ stateDir }, [
    new StandupCeremony({
      stateDir,
      listTickets: () => listTickets(stateDir),
      readTicket: (id) => readTicket(stateDir, id),
      commitState: async () => {
        await ensureRunPidGitignored(stateDir);
        await commitState(stateDir, "ceremony: standup");
      },
      appendTickLog,
      notify: async (title, message) => {
        await defaultCommandRunner()([
          "osascript",
          "-e",
          `display notification "${message}" with title "${title}"`,
        ]);
      },
    }),
  ]);

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
          stateDir,
          prompt: opts.prompt,
          scopeDirs: opts.scope.map(expandHome),
          outputFile: opts.outputFile,
          githubToken: resolveGitHubAccount(
            Object.keys(opts.worktrees)[0]?.split("/")[0] ?? "",
            config,
          ).token,
          anthropicApiKey,
          worktrees: opts.worktrees,
          provider: piProvider,
          agent: agentType,
          model: opts.model,
          thinking: opts.thinking,
          sessionId: opts.sessionId,
        }),
      isProcessAlive: (ticketId: string) =>
        isPhaseAlive(join(stateDir, ticketId)),
      writeTicket,
      writePhaseOutput,
      appendLog: appendTicketLog,
      resolveModelConfig: (phase, ticket) =>
        resolvePhaseModel(config, phase, ticket),
      selfReview: (phase, ticketDir) => selfReview(phase, ticketDir, fetch),
      readPhaseOutput: async (ticketDir, phase) => {
        const found = await findLatestPhaseOutput(ticketDir);
        if (!found || found.phaseName !== phase) return null;
        return await readTextFile(join(ticketDir, found.filename));
      },
      appendPrinciples: async (sd, ticketId, phase, outputContent) => {
        const extracted = extractPrinciples(outputContent);
        if (!extracted) return;
        const principlesPath = join(sd, "principles.md");
        let existing = "";
        try {
          existing = await Deno.readTextFile(principlesPath);
        } catch {
          // file does not exist yet
        }
        const novel = dedupePrinciples(existing, extracted);
        if (!novel) return;
        const newContent = existing.length > 0
          ? `${existing}\n\n${novel}`
          : novel;
        await Deno.writeTextFile(principlesPath, newContent);
        await commitPrinciples(sd, `principles: ${ticketId} ${phase}`);
      },
      markPRsReady: async (prUrls: string[]) => {
        for (const url of prUrls) {
          const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
          if (!match) throw new Error(`Cannot parse PR URL: ${url}`);
          const [, slug, number] = match;
          const { token } = resolveGitHubAccount(slug.split("/")[0], config);
          const restRes = await fetch(
            `https://api.github.com/repos/${slug}/pulls/${number}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
              },
            },
          );
          if (!restRes.ok) {
            throw new Error(
              `GitHub API error ${restRes.status} fetching PR node_id for ${url}`,
            );
          }
          const { node_id: nodeId } = await restRes.json();
          const graphqlRes = await fetch("https://api.github.com/graphql", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query:
                `mutation($input: MarkPullRequestReadyForReviewInput!) { markPullRequestReadyForReview(input: $input) { pullRequest { id } } }`,
              variables: { input: { pullRequestId: nodeId } },
            }),
          });
          if (!graphqlRes.ok) {
            throw new Error(
              `GitHub GraphQL error ${graphqlRes.status} promoting ${url} from draft`,
            );
          }
        }
      },
      readTicketLog: (ticketDir) =>
        readTextFile(join(ticketDir, "log.ndjson")).catch(() => ""),
      buildRepoCorpusText: () =>
        listRepoCorpus(
          config.codebase.roots.map(expandHome),
          config.github.repos,
        )
          .then(formatRepoCorpus),
      spawnOutlierAnalysis: async (ticketId, ticketDir, lazboyWorktreePath) => {
        const result = await detectImplementationOutlier(ticketDir);
        if (result === null) return;
        const prompt = await loadPromptFile("outlier-analysis.md");
        const outputFile = `${
          compactTimestamp(Temporal.Now.zonedDateTimeISO("UTC"))
        }-outlier-analysis.md`;
        await spawnPhase({
          ticketDir,
          stateDir,
          prompt:
            `${prompt}\n\nTicket ID: ${ticketId}\nTicket directory: ${ticketDir}`,
          scopeDirs: [],
          outputFile,
          githubToken: resolveGitHubAccount("jackjennings", config).token,
          anthropicApiKey,
          worktrees: {
            "jackjennings/lazyboy": { path: lazboyWorktreePath, branch: "" },
          },
          provider: piProvider,
          agent: agentType,
          model: "claude-sonnet-4-6",
          thinking: "high",
          pidFile: "outlier-analysis.pid",
        });
      },
    },
    runMigrations: createMigrationRunner({
      listMigrationFiles: async () => {
        const files: string[] = [];
        try {
          for await (const entry of readDir(migrationsDir)) {
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
          const content = await readTextFile(join(dir, ".migrations"));
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
        const raw = await readTextFile(lastWorkedPath);
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
    notify: makeNotify(stateDir, {
      readLog: (sd, id) =>
        readTextFile(join(sd, id, "log.ndjson")).catch(() => ""),
      appendLog: appendTicketLog,
      runCommand: defaultCommandRunner(),
    }),
    runCeremonies: () => ceremonies.run(),
  };
}
