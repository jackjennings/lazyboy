import { existsSync } from "@std/fs";
import { CeremonyRunner } from "./ceremonies.ts";
import { StandupCeremony } from "./ceremonies/standup.ts";
import { DocumentationGapsCeremony } from "./ceremonies/documentation-gaps.ts";
import { join } from "@std/path";
import {
  detectImplementationOutlier,
  detectPlanOutlier,
} from "./outlier-detection.ts";
import { compactTimestamp } from "./timestamp.ts";
import { loadPromptFile } from "./phases/runners.ts";
import {
  appendTicketLog,
  commitPrinciples,
  commitState,
  listLearnings,
  listTickets,
  readTicket,
  writeLearning,
  writePhaseOutput,
  writeTicket,
} from "./state/store.ts";
import {
  dedupePrinciples,
  extractPrinciples,
  judgePrinciples,
  readPhaseSessionId,
} from "./run-phase.ts";
import { expandHome } from "./config.ts";
import { GitHubProvider } from "./providers/github.ts";
import { JiraProvider } from "./providers/jira.ts";
import { TodoTxtProvider } from "./providers/todo-txt.ts";
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
import { cleanOrphanedWorktreesAction } from "./tick-actions/clean-orphaned-worktrees.ts";
import { reconcilePRsAction } from "./tick-actions/reconcile-prs.ts";
import { checkConflictsAction } from "./tick-actions/check-conflicts.ts";
import { resolveConflictsAction } from "./tick-actions/resolve-conflicts.ts";
import { spawnCITriageAction } from "./tick-actions/spawn-ci-triage.ts";
import { resolveCITriageAction } from "./tick-actions/resolve-ci-triage.ts";
import {
  installPackages,
  isPackageInstalled,
  runPiInstall,
} from "./packages.ts";
import { createMigrationRunner } from "./migrations/runner.ts";
import type { Migration, StoreMigration } from "./migrations/types.ts";
import {
  appendTickLog,
  resolvePhaseModel,
  type TickServiceDeps,
} from "./tick.ts";
import { adjudicatePhaseModel } from "./pre-phase-adjudication.ts";
import {
  captureCommandRunner,
  checkApfelAvailable,
  defaultCommandRunner,
} from "./apfel.ts";
import { generateShortTitle as apfelGenerateShortTitle } from "./short-title.ts";
import { makeNotify } from "./notify.ts";
import { PidFileLock } from "./lock.ts";
import { selfReview } from "./self-review.ts";
import { applyLearning } from "./apply-learning.ts";
import { processLearnings as runLearnings } from "./learnings.ts";
import { findLatestPhaseOutput } from "./review.ts";
import { refreshAnthropicPricingIfStale } from "./anthropic-pricing.ts";
import type { Config } from "./state/types.ts";
import { readDir, readTextFile, remove, stat } from "./fs.ts";
import { PHASE_SEQUENCE } from "./phases/types.ts";
import { HttpClient } from "./http-client.ts";

export async function ensureStatePrompts(
  stateDir: string,
  githubRepos: string[] = [],
  jiraProject?: string,
): Promise<void> {
  const promptsDir = join(stateDir, "prompts");
  await Deno.mkdir(promptsDir, { recursive: true });

  async function scaffoldPhaseFiles(dir: string): Promise<void> {
    await Deno.mkdir(dir, { recursive: true });
    for (const phase of PHASE_SEQUENCE) {
      const filePath = join(dir, `${phase}.md`);
      try {
        await Deno.stat(filePath);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          await Deno.writeTextFile(filePath, "");
        } else {
          throw e;
        }
      }
    }
  }

  await scaffoldPhaseFiles(promptsDir);

  for (const repo of githubRepos) {
    const [org, name] = repo.split("/");
    await scaffoldPhaseFiles(join(promptsDir, "github", org, name));
  }

  if (jiraProject) {
    await scaffoldPhaseFiles(join(promptsDir, "jira", jiraProject));
  }
}

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

export function deriveOrgFromTicketDir(
  ticketDir: string,
  stateDir: string,
): string {
  const parts = ticketDir.slice(stateDir.length + 1).split("/");
  if (parts[0] !== "github") return "";
  return parts[1] ?? "";
}

export function composeTickDeps(
  config: Config,
): TickServiceDeps {
  const stateDir = expandHome(config.state.dir);
  const home = Deno.env.get("HOME")!;
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const piProvider = config.pi.provider;
  const agentType = config.agent.type;

  const http = new HttpClient();

  const githubProvider = new GitHubProvider({
    repos: config.github.repos,
    accountResolver: (org) => resolveGitHubAccount(org, config),
    http,
  });

  const providers: Provider[] = [githubProvider];

  if (config.jira) {
    providers.push(
      new JiraProvider({
        baseUrl: config.jira.baseUrl,
        email: Deno.env.get("JIRA_EMAIL") ?? "",
        apiToken: Deno.env.get("JIRA_API_TOKEN") ?? "",
        project: config.jira.project,
        http,
        run: captureCommandRunner(),
      }),
    );
  }

  if (config.todoTxt) {
    providers.push(new TodoTxtProvider({ file: config.todoTxt.file }));
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
      applyWorktreeInclude: async (
        worktreePath: string,
        sourcePath: string,
      ) => {
        const result = await new Deno.Command("git-worktreeinclude", {
          args: ["apply", "--from", sourcePath],
          cwd: worktreePath,
        }).output();
        if (!result.success) {
          throw new Error(
            `git-worktreeinclude apply exited ${result.code}: ${
              new TextDecoder().decode(result.stderr)
            }`,
          );
        }
      },
    }),
    reconcilePRsAction({
      readImplementationOutput: async (ticketDir: string) => {
        const files: string[] = [];
        try {
          for await (const entry of readDir(ticketDir)) {
            if (
              entry.isFile &&
              /^\d{8}T\d{6}-implementation\.md$/.test(entry.name)
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
      getPRInfo: (url: string) => githubProvider.prMetadata(url),
      writeTicket,
      appendLog: appendTicketLog,
    }),
    checkMergedPRAction({
      isPRMerged: (url) => githubProvider.isPRMerged(url),
      cleanupWorktree: removeWorktree,
      closeWorkItem: (url: string) => githubProvider.close(url),
      writeTicket,
      appendLog: appendTicketLog,
    }),
    cleanOrphanedWorktreesAction({
      isProcessAlive: (ticketId: string) =>
        isPhaseAlive(join(stateDir, ticketId)),
      cleanupWorktree: removeWorktree,
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
      readPhaseSessionId,
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
    ...(config.tick.resolveCIFailures
      ? [
        resolveCITriageAction({
          isProcessAlive: (ticketId) => isPhaseAlive(join(stateDir, ticketId)),
          hasCITriageContextFiles: (ticketId) => {
            const dir = join(stateDir, ticketId);
            try {
              for (const entry of Deno.readDirSync(dir)) {
                if (
                  entry.isFile &&
                  entry.name.includes("-ci-triage-context-") &&
                  entry.name.endsWith(".md")
                ) {
                  return true;
                }
              }
            } catch {
              return false;
            }
            return false;
          },
          readDir,
          readFile: async (path) => {
            try {
              return await Deno.readTextFile(path);
            } catch {
              return null;
            }
          },
          remove,
          createGitHubIssue: async ({ repo, title, body }) => {
            const { token, login } = resolveGitHubAccount(
              repo.split("/")[0],
              config,
            );
            const res = await http.post(
              `https://api.github.com/repos/${repo}/issues`,
              {
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
          writeTicket,
          appendLog: appendTicketLog,
        }),
        spawnCITriageAction({
          getPRChecks: async (prUrl) => {
            const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
            if (!m) return null;
            const [, repoSlug, prNumber] = m;
            const { token } = resolveGitHubAccount(
              repoSlug.split("/")[0],
              config,
            );
            const prRes = await http.get(
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
            if (prData.state === "closed") return null;
            const headSha: string = prData.head.sha;
            const suiteRes = await http.get(
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
              suites as Array<
                { status: string; conclusion: string; id: number }
              >
            ).find((s) => s.status === "completed");
            if (!suite) return null;
            if (
              suite.conclusion !== "failure" &&
              suite.conclusion !== "action_required"
            ) {
              return {
                runId: String(suite.id),
                conclusion: suite.conclusion as "success" | "pending",
                failingOutput: "",
              };
            }
            const runsRes = await http.get(
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
              }>
            ).find((r) => r.conclusion === "failure");
            const stepName = failing?.name ?? "";
            return {
              runId: String(suite.id),
              conclusion: suite.conclusion as "failure" | "action_required",
              failingOutput: stepName,
            };
          },
          getPRDiffFiles: async (prUrl) => {
            const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
            if (!m) return [];
            const [, repoSlug, prNumber] = m;
            const { token } = resolveGitHubAccount(
              repoSlug.split("/")[0],
              config,
            );
            const res = await http.get(
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
            return (files as Array<{ filename: string; patch?: string }>).map((
              f,
            ) => ({
              filename: f.filename,
              patch: f.patch,
            }));
          },
          isProcessAlive: (ticketId) => isPhaseAlive(join(stateDir, ticketId)),
          writeTicket,
          appendLog: appendTicketLog,
          resolveModelConfig: (ticket) =>
            resolvePhaseModel(config, "ci-triage", ticket),
          writeContextFile: async (ticketDir, runId, content) => {
            const timestamp = compactTimestamp(
              Temporal.Now.zonedDateTimeISO("UTC"),
            );
            const filename = `${timestamp}-ci-triage-context-${runId}.md`;
            await Deno.writeTextFile(join(ticketDir, filename), content);
            return filename;
          },
          spawn: (opts) => {
            const timestamp = opts.contextFile.slice(
              0,
              opts.contextFile.indexOf("-ci-triage-context-"),
            );
            const prompt =
              `You are triaging a CI failure. Read the context file for the PR URL, repo, and PR diff. ` +
              `The ## CI Output section contains only the name of the failing check — not the full log. ` +
              `Use \`gh pr checks <PR-URL>\` to locate the failing workflow run, then ` +
              `\`gh run view --repo <Repo> <run-id> --log-failed\` to fetch the actual failure output. ` +
              `Use that log in your analysis.\n\n` +
              `Decide whether the failure was caused by the PR's changes (PR_CAUSED) or by an ` +
              `infrastructure problem unrelated to the PR (INFRA). Infrastructure failures are: ` +
              `network errors, rate limits, runner timeouts, package download failures, transient ` +
              `flakiness with no code correlation. Default to PR_CAUSED unless there is positive ` +
              `evidence of infrastructure failure — a red CI run on a PR branch is overwhelmingly ` +
              `the PR's fault. Write your reasoning, then end your output with exactly one line: ` +
              `\`VERDICT: PR_CAUSED\` or \`VERDICT: INFRA\`.`;
            return spawnPhase({
              ticketDir: opts.ticketDir,
              stateDir,
              prompt,
              scopeDirs: [],
              outputFile: `${timestamp}-ci-triage-${opts.runId}.md`,
              githubToken: resolveGitHubAccount(
                opts.repo.split("/")[0],
                config,
              ).token,
              anthropicApiKey,
              worktrees: opts.worktreePath
                ? {
                  [opts.branch]: {
                    path: opts.worktreePath,
                    branch: opts.branch,
                  },
                }
                : {},
              provider: piProvider,
              agent: agentType,
              model: opts.model,
              thinking: opts.thinking,
              contextFiles: [
                `@${opts.ticketDir}/meta.md`,
                `@${opts.ticketDir}/${opts.contextFile}`,
              ],
            });
          },
        }),
      ]
      : []),
    ...(config.jira
      ? [
        jiraPickupAction({
          baseUrl: config.jira.baseUrl,
          email: Deno.env.get("JIRA_EMAIL") ?? "",
          apiToken: Deno.env.get("JIRA_API_TOKEN") ?? "",
          appendLog: appendTicketLog,
          http,
        }),
        jiraDoneAction({
          baseUrl: config.jira.baseUrl,
          email: Deno.env.get("JIRA_EMAIL") ?? "",
          apiToken: Deno.env.get("JIRA_API_TOKEN") ?? "",
          writeTicket,
          appendLog: appendTicketLog,
          http,
        }),
      ]
      : []),
  ];

  const migrationsDir = new URL("../migrations", import.meta.url).pathname;
  const lastWorkedPath = join(home, ".lazyboy", "last-worked.json");

  const ceremonies = new CeremonyRunner({ stateDir, appendTickLog }, [
    new StandupCeremony({
      listTickets: () => listTickets(stateDir),
      readTicket: (id) => readTicket(stateDir, id),
      commitState: async () => {
        await ensureRunPidGitignored(stateDir);
        await commitState(stateDir, "ceremony: standup");
      },
      notify: async (title, message) => {
        await defaultCommandRunner()([
          "osascript",
          "-e",
          `display notification "${message}" with title "${title}"`,
        ]);
      },
    }),
    new DocumentationGapsCeremony({
      stateDir,
      repoDir: new URL("../", import.meta.url).pathname,
      run: captureCommandRunner(),
      commitState: async () => {
        await ensureRunPidGitignored(stateDir);
        await commitState(stateDir, "ceremony: documentation-gaps");
      },
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
    packageSources: config.pi.packages,
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
            deriveOrgFromTicketDir(opts.ticketDir, stateDir),
            config,
          ).token,
          anthropicApiKey,
          worktrees: opts.worktrees,
          provider: piProvider,
          agent: agentType,
          model: opts.model,
          thinking: opts.thinking,
          sessionId: opts.sessionId,
          includePrinciples: config.tick.principles,
        }),
      isProcessAlive: (ticketId: string) =>
        isPhaseAlive(join(stateDir, ticketId)),
      writeTicket,
      writePhaseOutput,
      appendLog: appendTicketLog,
      resolveModelConfig: (phase, ticket) =>
        resolvePhaseModel(config, phase, ticket),
      selfReview: (phase, ticketDir) =>
        selfReview(phase, ticketDir, captureCommandRunner()),
      readPhaseOutput: async (ticketDir, phase) => {
        const found = await findLatestPhaseOutput(ticketDir);
        if (!found || found.phaseName !== phase) return null;
        return await readTextFile(join(ticketDir, found.filename));
      },
      appendPrinciples: async (sd, ticketId, phase, outputContent) => {
        if (!config.tick.principles) return;
        const extracted = extractPrinciples(outputContent);
        if (!extracted) return;
        const substantive = await judgePrinciples(
          extracted,
          captureCommandRunner(),
        );
        if (!substantive) return;
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
      readPhaseExitCode: async (ticketDir, phase) => {
        const pattern = new RegExp(
          `^\\d{8}T\\d{6}-${phase}\\.md\\.exit$`,
        );
        const matches: string[] = [];
        try {
          for await (const entry of Deno.readDir(ticketDir)) {
            if (entry.isFile && pattern.test(entry.name)) {
              matches.push(entry.name);
            }
          }
        } catch {
          // dir missing
        }
        if (matches.length === 0) return null;
        matches.sort();
        const content = await Deno.readTextFile(
          join(ticketDir, matches[matches.length - 1]),
        );
        return parseInt(content, 10);
      },
      markPRsReady: async (prUrls: string[]) => {
        for (const url of prUrls) {
          const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
          if (!match) throw new Error(`Cannot parse PR URL: ${url}`);
          const [, slug, number] = match;
          const { token } = resolveGitHubAccount(slug.split("/")[0], config);
          const restRes = await http.get(
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
          const graphqlRes = await http.post("https://api.github.com/graphql", {
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
      readPhaseSessionId,
      buildRepoCorpusText: () =>
        listRepoCorpus(
          config.codebase.roots.map(expandHome),
          config.github.repos,
        )
          .then(formatRepoCorpus),
      adjudicatePhaseModel,
      spawnOutlierAnalysis: async (
        ticketId,
        ticketDir,
        lazboyWorktreePath,
        phase,
      ) => {
        const result = phase === "plan"
          ? await detectPlanOutlier(ticketDir)
          : await detectImplementationOutlier(ticketDir);
        if (result === null) return;
        const promptFile = phase === "plan"
          ? "plan-outlier-analysis.md"
          : "outlier-analysis.md";
        const pidFile = phase === "plan"
          ? "plan-outlier-analysis.pid"
          : "outlier-analysis.pid";
        const outputSuffix = phase === "plan"
          ? "plan-outlier-analysis"
          : "outlier-analysis";
        const prompt = await loadPromptFile(promptFile);
        const outputFile = `${
          compactTimestamp(Temporal.Now.zonedDateTimeISO("UTC"))
        }-${outputSuffix}.md`;
        await spawnPhase({
          ticketDir,
          stateDir,
          prompt:
            `${prompt}\n\nTicket ID: ${ticketId}\nTicket directory: ${ticketDir}\nState directory: ${stateDir}`,
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
          pidFile,
        });
      },
      maxPromptTokens: config.tick.maxPromptTokens,
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
      loadMigration: async (
        id: string,
      ): Promise<Migration | StoreMigration> => {
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
    processLearnings: () =>
      runLearnings({
        listLearnings: () => listLearnings(stateDir),
        writeLearning: (learning, intent) =>
          writeLearning(stateDir, learning, intent),
        prState: (url) => githubProvider.prState(url),
        log: (entry) => {
          console.error("processLearnings:", entry);
          return Promise.resolve();
        },
        applyToRepo: async (learning, intent) => {
          const localRepoPath = await findLocalRepo(
            config.codebase.roots.map(expandHome),
            learning.repo,
          );
          if (localRepoPath === null) {
            throw new Error(`local repo not found for ${learning.repo}`);
          }
          const wt = await createWorktree(
            localRepoPath,
            `learnings-${learning.id}`,
            learning.repo.split("/")[1],
          );
          try {
            const targetPath = join(wt.path, learning.targetFile);
            const currentContent = await Deno.readTextFile(targetPath).catch(
              () => "",
            );
            const applied = await applyLearning(
              currentContent,
              intent,
              captureCommandRunner(),
            );
            if (applied === null) {
              throw new Error("applyLearning returned no content");
            }
            await Deno.mkdir(
              join(wt.path, ...learning.targetFile.split("/").slice(0, -1)),
              { recursive: true },
            );
            await Deno.writeTextFile(targetPath, applied);
            const run = (cmd: string[]) =>
              new Deno.Command(cmd[0], {
                args: cmd.slice(1),
                cwd: wt.path,
              }).output();
            await run(["git", "add", learning.targetFile]);
            await run(["git", "commit", "-m", learning.prTitle]);
            const created = await run([
              "gh",
              "pr",
              "create",
              "--draft",
              "--title",
              learning.prTitle,
              "--body",
              learning.prBody,
            ]);
            const url = new TextDecoder()
              .decode(created.stdout)
              .trim()
              .split("\n")
              .filter((line) => line.startsWith("http"))
              .pop();
            if (url === undefined) {
              throw new Error("could not parse PR URL from gh output");
            }
            return url;
          } finally {
            await removeWorktree(wt);
          }
        },
      }),
    notify: makeNotify({
      runCommand: defaultCommandRunner(),
    }),
    notifyTickFailure: async (error: string) => {
      const escaped = error.replaceAll("'", "\\'");
      const body = escaped.slice(0, 200);
      await defaultCommandRunner()([
        "osascript",
        "-e",
        `display notification "${body}" with title "Tick failed"`,
      ]);
    },
    scaffoldStatePrompts: () =>
      ensureStatePrompts(
        stateDir,
        config.github.repos,
        config.jira?.project,
      ),
    runCeremonies: () => ceremonies.run(),
    generateShortTitle: async (title, context) => {
      const available = await checkApfelAvailable(defaultCommandRunner());
      if (!available) return null;
      return apfelGenerateShortTitle(captureCommandRunner(), title, context);
    },
    agentsMdPaths: config.tick.agentsMdMaxTokens > 0
      ? config.codebase.roots.map(expandHome).map((r) => join(r, "AGENTS.md"))
      : undefined,
    agentsMdMaxTokens: config.tick.agentsMdMaxTokens > 0
      ? config.tick.agentsMdMaxTokens
      : undefined,
  };
}
