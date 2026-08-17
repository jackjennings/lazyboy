import { CeremonyRunner } from "./ceremonies.ts";
import { DocumentationGapsCeremony } from "./ceremonies/documentation-gaps.ts";
import { dirname, join } from "@std/path";
import {
  detectImplementationOutlier,
  detectPlanOutlier,
} from "./outlier-detection.ts";
import { compactTimestamp } from "./timestamp.ts";
import { loadPromptFile } from "./phases/runners.ts";
import { deriveProjectPath } from "./phases/project-path.ts";
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
import { pushState } from "./state/push.ts";
import {
  dedupePrinciples,
  extractPrinciples,
  readPhaseSessionId,
} from "./run-phase.ts";
import { judgePrinciples } from "./judge-principles.ts";
import { expandHome } from "./config.ts";
import { lazyboyDir } from "./paths.ts";
import { GitHubProvider } from "./providers/github.ts";
import { JiraProvider } from "./providers/jira.ts";
import { TodoTxtProvider } from "./providers/todo-txt.ts";
import type { Provider } from "./providers/types.ts";
import { jiraPickupAction } from "./tick-actions/jira-pickup.ts";
import { jiraDoneAction } from "./tick-actions/jira-done.ts";
import { isPhaseAlive, spawnPhase } from "./executor.ts";
import { bootId } from "./paths.ts";
import {
  cloneRemoteRepo,
  createWorktree,
  findLocalRepo,
  formatRepoCorpus,
  initLocalRepo,
  listRepoCorpus,
  removeWorktree,
  runGit,
} from "./worktree.ts";
import { createWorktreeAction } from "./tick-actions/create-worktree.ts";
import { createRemoteRepoAction } from "./tick-actions/create-remote-repo.ts";
import { checkMergedPRAction } from "./tick-actions/check-merged-pr.ts";
import { cleanOrphanedWorktreesAction } from "./tick-actions/clean-orphaned-worktrees.ts";
import { reconcilePRsAction } from "./tick-actions/reconcile-prs.ts";
import { checkConflictsAction } from "./tick-actions/check-conflicts.ts";
import { resolveConflictsAction } from "./tick-actions/resolve-conflicts.ts";
import { spawnCIFixAction } from "./tick-actions/spawn-ci-fix.ts";
import { resolveCIFixAction } from "./tick-actions/resolve-ci-fix.ts";
import {
  checkNewCommentsAction,
  type RawComment,
} from "./tick-actions/check-new-comments.ts";
import { judgeComment } from "./judge-comment.ts";
import { adf2markdown } from "adf2markdown";
import {
  installPackages,
  isPackageInstalled,
  runPiInstall,
} from "./packages.ts";
import { createMigrationRunner } from "./migrations/runner.ts";
import type { Migration, StoreMigration } from "./migrations/types.ts";
import { appendTickLog, type TickServiceDeps } from "./tick.ts";
import { resolvePhaseModel } from "./phases/model.ts";
import { adjudicatePhaseModel } from "./pre-phase-adjudication.ts";
import {
  captureCommandRunner,
  checkApfelAvailable,
  defaultCommandRunner,
} from "./apfel.ts";
import { generateShortTitle as apfelGenerateShortTitle } from "./short-title.ts";
import { makeDesktopNotifier, makeNotify } from "./notify.ts";
import { PidFileLock } from "./lock.ts";
import { selfReview } from "./self-review.ts";
import { applyLearning } from "./apply-learning.ts";
import { processLearnings as runLearnings } from "./learnings.ts";
import { findLatestPhaseOutput } from "./review.ts";
import { refreshAnthropicPricingIfStale } from "./anthropic-pricing.ts";
import type { Config } from "./state/types.ts";
import {
  exists,
  existsSync,
  mkdir,
  readDir,
  readDirSync,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from "./filesystem.ts";
import { PHASE_SEQUENCE } from "./phases/types.ts";
import { HttpClient } from "./http-client.ts";
import { ClaudeLanguageModel } from "./models/claude.ts";

export async function ensureStatePrompts(
  stateDir: string,
  githubRepos: string[] = [],
  jiraProject?: string,
): Promise<void> {
  const promptsDir = join(stateDir, "prompts");
  await mkdir(promptsDir, { recursive: true });

  async function scaffoldPhaseFiles(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    for (const phase of PHASE_SEQUENCE) {
      const filePath = join(dir, `${phase}.md`);
      try {
        await stat(filePath);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          await writeTextFile(filePath, "");
        } else {
          throw e;
        }
      }
    }
    for (const phase of ["spec", "plan", "implementation"]) {
      const filePath = join(dir, `${phase}-revision.md`);
      try {
        await stat(filePath);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          await writeTextFile(filePath, "");
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
    content = await readTextFile(gitignorePath);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const lines = content.split("\n");
  if (lines.some((l) => l.trim() === "run.pid")) return;
  await writeTextFile(
    gitignorePath,
    content ? content + "run.pid\n" : "run.pid\n",
  );
}

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

type CommandRunner = (
  cmd: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

async function validateGitHubToken(
  opts: { fetch: FetchFn },
  token: string,
  errorMessage: string,
): Promise<Response> {
  const res = await opts.fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new GitHubAuthError(errorMessage);
  }
  return res;
}

async function resolveBareGitHubToken(
  opts: { run: CommandRunner },
): Promise<string> {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (token) return token;
  const result = await opts.run(["gh", "auth", "token"]);
  if (result.code !== 0 || result.stdout.trim() === "") {
    throw new GitHubAuthError(
      `GITHUB_TOKEN is not set and \`gh auth token\` failed: ${result.stderr}`,
    );
  }
  const resolved = result.stdout.trim();
  Deno.env.set("GITHUB_TOKEN", resolved);
  return resolved;
}

export async function preflightGitHubCredentials(
  config: Config,
  opts: { run: CommandRunner; fetch: FetchFn },
): Promise<void> {
  if (config.github.accounts) {
    const tokenToEnv = new Map<string, string>();
    for (const account of Object.values(config.github.accounts)) {
      const token = Deno.env.get(account.tokenEnv);
      if (!token) {
        throw new GitHubAuthError(`${account.tokenEnv} is not set`);
      }
      if (!tokenToEnv.has(token)) {
        tokenToEnv.set(token, account.tokenEnv);
      }
    }
    for (const [token, tokenEnv] of tokenToEnv) {
      await validateGitHubToken(
        opts,
        token,
        `GitHub authentication failed for ${tokenEnv} — check that the token is set and valid`,
      );
    }

    const hasUnmappedOrg = config.github.repos.some(
      (repo) => !config.github.orgs?.[repo.split("/")[0]],
    );
    if (!hasUnmappedOrg) return;
  }

  const token = await resolveBareGitHubToken(opts);
  const res = await validateGitHubToken(
    opts,
    token,
    "GitHub authentication failed — check that GITHUB_TOKEN is set and `gh auth status` is valid",
  );

  if (!Deno.env.get("GITHUB_LOGIN")) {
    const data = await res.json();
    Deno.env.set("GITHUB_LOGIN", data.login);
  }
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
      initLocalRepo,
      stat: exists,
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
    createRemoteRepoAction({
      createRepo: (slug) => githubProvider.createRepo(slug),
      isPhaseAlive: (ticketId) => isPhaseAlive(join(stateDir, ticketId)),
      writeTicket,
      appendLog: appendTicketLog,
      runGit,
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
      stat: exists,
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
        await writeTextFile(join(ticketDir, filename), content);
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
        resolveCIFixAction({
          isProcessAlive: (ticketId) => isPhaseAlive(join(stateDir, ticketId)),
          hasCIFixContextFiles: (ticketId) => {
            const dir = join(stateDir, ticketId);
            try {
              for (const entry of readDirSync(dir)) {
                if (
                  entry.isFile &&
                  entry.name.includes("-ci-fix-context-") &&
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
              return await readTextFile(path);
            } catch {
              return null;
            }
          },
          remove,
          runGit,
          rerunFailedJobs: async ({ repo, runId }) => {
            const { token } = resolveGitHubAccount(repo.split("/")[0], config);
            const res = await http.post(
              `https://api.github.com/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/vnd.github+json",
                  "Content-Type": "application/json",
                },
                body: "{}",
              },
            );
            if (!res.ok) {
              throw new Error(
                `GitHub API ${res.status} re-running failed jobs`,
              );
            }
          },
          writeTicket,
          appendLog: appendTicketLog,
          writeLearning: async (learning, intent) => {
            const id = compactTimestamp(Temporal.Now.zonedDateTimeISO("UTC"));
            await writeLearning(stateDir, { id, ...learning }, intent);
          },
        }),
        spawnCIFixAction({
          getPRChecks: async (prUrl) => {
            const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
            if (!m) return null;
            const [, repoSlug, prNumber] = m;
            const { token } = resolveGitHubAccount(
              repoSlug.split("/")[0],
              config,
            );
            const headers = {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
            };
            const prRes = await http.get(
              `https://api.github.com/repos/${repoSlug}/pulls/${prNumber}`,
              { headers },
            );
            if (!prRes.ok) throw new Error(`GitHub API ${prRes.status}`);
            const prData = await prRes.json();
            if (prData.state === "closed") return null;
            const headSha: string = prData.head.sha;

            const runsRes = await http.get(
              `https://api.github.com/repos/${repoSlug}/actions/runs?head_sha=${headSha}&per_page=100`,
              { headers },
            );
            if (!runsRes.ok) throw new Error(`GitHub API ${runsRes.status}`);
            const { workflow_runs: workflowRuns } = await runsRes.json();
            const completed = (workflowRuns as Array<{
              id: number;
              status: string;
              conclusion: string;
              run_attempt: number;
            }>).filter((r) => r.status === "completed");
            if (completed.length === 0) return null;

            const failed = completed.find(
              (r) =>
                r.conclusion === "failure" ||
                r.conclusion === "action_required",
            );
            if (!failed) {
              return {
                runId: String(completed[0].id),
                attempt: completed[0].run_attempt,
                conclusion: "success",
                failingJobs: [],
                headSha,
              };
            }

            const jobsRes = await http.get(
              `https://api.github.com/repos/${repoSlug}/actions/runs/${failed.id}/attempts/${failed.run_attempt}/jobs?per_page=100`,
              { headers },
            );
            const failingJobs = jobsRes.ok
              ? ((await jobsRes.json()).jobs as Array<{
                name: string;
                conclusion: string;
              }>)
                .filter((j) => j.conclusion === "failure")
                .map((j) => j.name)
              : [];

            return {
              runId: String(failed.id),
              attempt: failed.run_attempt,
              conclusion: failed.conclusion as "failure" | "action_required",
              failingJobs,
              headSha,
            };
          },
          isProcessAlive: (ticketId) => isPhaseAlive(join(stateDir, ticketId)),
          writeTicket,
          appendLog: appendTicketLog,
          resolveModelConfig: (ticket) =>
            resolvePhaseModel(config, "ci-fix", ticket),
          writeContextFile: async (ticketDir, runKey, content) => {
            const timestamp = compactTimestamp(
              Temporal.Now.zonedDateTimeISO("UTC"),
            );
            const filename = `${timestamp}-ci-fix-context-${runKey}.md`;
            await writeTextFile(join(ticketDir, filename), content);
            return filename;
          },
          spawn: (opts) => {
            const timestamp = opts.contextFile.slice(
              0,
              opts.contextFile.indexOf("-ci-fix-context-"),
            );
            const prompt =
              `You are fixing a failing CI run on an open pull request. Your job is to make CI ` +
              `green, not to write a report.\n\n` +
              `Read the context file for the PR URL, repo, workflow run ID, branch, and worktree ` +
              `path, then work inside that worktree.\n\n` +
              `Fetch the real failure output with ` +
              `\`gh run view --repo <Repo> <Run-ID> --log-failed\`. Read the workflow definition in ` +
              `.github/workflows/ to find the exact command the failing job ran.\n\n` +
              `Decide whether the failure comes from the PR's own changes or from infrastructure. ` +
              `Infrastructure failures are network errors, rate limits, runner timeouts, package ` +
              `download failures, and transient flakiness with no code correlation. Default to a ` +
              `PR-side cause — a red run on a PR branch is overwhelmingly the PR's fault.\n\n` +
              `Fix it in the worktree. Reproduce the failure locally with the job's own command, ` +
              `fix it, re-run that command, and confirm it passes before claiming FIXED. Two common ` +
              `cases:\n` +
              `- Lint or format violations, often left behind by conflict resolution: run the ` +
              `repository's own check command (for example \`deno fmt\` and \`deno lint\`) and ` +
              `commit the result.\n` +
              `- Commit messages rejected by commitlint: reword the offending commits rather than ` +
              `adding a new one. Prefer \`git commit --amend -m\` when only the tip commit is bad. ` +
              `For older commits use a non-interactive rebase driven by GIT_SEQUENCE_EDITOR and ` +
              `GIT_EDITOR. As a last resort, ` +
              `\`git reset --soft $(git merge-base origin/<base-branch> HEAD)\` and re-commit with ` +
              `a conforming message.\n\n` +
              `Commit your work, but do not push — the tick loop force-pushes the branch for you. ` +
              `Do not create pull requests and do not create issues.\n\n` +
              `End your output with exactly one line: \`VERDICT: FIXED\`, \`VERDICT: INFRA\`, or ` +
              `\`VERDICT: UNFIXABLE\`. Use INFRA only for an infrastructure failure, and UNFIXABLE ` +
              `only when the failure genuinely requires a human decision. When the verdict is ` +
              `FIXED, add one more line immediately after: ` +
              `\`LEARNING: <one or two sentences describing what the implementation phase should ` +
              `have checked or validated to catch this failure before it reached CI>\`.`;
            return spawnPhase({
              ticketDir: opts.ticketDir,
              stateDir,
              prompt,
              scopeDirs: [],
              outputFile:
                `${timestamp}-ci-fix-${opts.runId}-${opts.attempt}.md`,
              githubToken:
                resolveGitHubAccount(opts.repo.split("/")[0], config).token,
              anthropicApiKey,
              worktrees: {
                [opts.branch]: { path: opts.worktreePath, branch: opts.branch },
              },
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
          writeTicket,
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
    checkNewCommentsAction({
      isProcessAlive: (ticketId) => isPhaseAlive(join(stateDir, ticketId)),
      writeTicket,
      appendLog: appendTicketLog,
      fetchGitHubComments: async (ticketId, since) => {
        const parts = ticketId.split("/");
        const org = parts[1];
        const repo = parts[2];
        const number = parts[3];
        const { token } = resolveGitHubAccount(org, config);
        const url =
          `https://api.github.com/repos/${org}/${repo}/issues/${number}/comments` +
          (since ? `?since=${encodeURIComponent(since)}` : "");
        const res = await http.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        });
        if (!res.ok) {
          throw new Error(`GitHub API ${res.status} fetching comments`);
        }
        const items = (await res.json()) as Array<{
          user: { login: string };
          body: string;
          created_at: string;
        }>;
        return items.map((c): RawComment => ({
          author: c.user.login,
          body: c.body ?? "",
          timestamp: c.created_at,
        }));
      },
      fetchJiraComments: async (issueKey, since) => {
        const auth = btoa(
          `${Deno.env.get("JIRA_EMAIL") ?? ""}:${
            Deno.env.get("JIRA_API_TOKEN") ?? ""
          }`,
        );
        const url = `${
          config.jira!.baseUrl
        }/rest/api/3/issue/${issueKey}/comment?maxResults=50`;
        const res = await http.get(url, {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        });
        if (!res.ok) {
          throw new Error(`Jira API ${res.status} fetching comments`);
        }
        const data = (await res.json()) as {
          comments: Array<{
            author: { displayName: string; emailAddress?: string };
            body: unknown;
            created: string;
          }>;
        };
        return (data.comments ?? [])
          .filter(
            (c) =>
              !since || Temporal.Instant.from(c.created).toString() > since,
          )
          .map((c): RawComment => ({
            author: c.author.displayName,
            body: c.body == null || typeof c.body !== "object"
              ? ""
              // deno-lint-ignore no-explicit-any
              : adf2markdown(c.body as any).trim(),
            timestamp: Temporal.Instant.from(c.created).toString(),
          }));
      },
      isBot: (() => {
        const botLogins = new Set<string>();
        if (config.github.accounts) {
          for (const account of Object.values(config.github.accounts)) {
            botLogins.add(account.login);
          }
        } else {
          const login = Deno.env.get("GITHUB_LOGIN");
          if (login) botLogins.add(login);
        }
        const jiraEmail = Deno.env.get("JIRA_EMAIL");
        if (jiraEmail) botLogins.add(jiraEmail);
        return (author: string) => botLogins.has(author);
      })(),
      judgeComment: (body) => judgeComment(body, captureCommandRunner()),
      writeContextFile: async (ticketDir, content) => {
        const timestamp = compactTimestamp(
          Temporal.Now.zonedDateTimeISO("UTC"),
        );
        await writeTextFile(
          join(ticketDir, `${timestamp}-comment-context.md`),
          content,
        );
      },
      config,
    }),
  ];

  const migrationsDir = new URL("../migrations", import.meta.url).pathname;
  const lastWorkedPath = join(home, ".lazyboy", "last-worked.json");

  const desktopNotifier = makeDesktopNotifier({
    runCommand: defaultCommandRunner(),
  });

  const ceremonies = new CeremonyRunner(
    {
      stateDir,
      appendTickLog,
      notify: desktopNotifier,
      listTickets: () => listTickets(stateDir),
      readTicket: (id) => readTicket(stateDir, id),
      generateText: (request) =>
        new ClaudeLanguageModel(captureCommandRunner(), {
          model: "claude-sonnet-4-6",
        }).generateText(request),
      commitState: async () => {
        await ensureRunPidGitignored(stateDir);
        await commitState(stateDir, "ceremony: state-dir");
      },
    },
    [
      new DocumentationGapsCeremony({
        stateDir,
        repoDir: new URL("../", import.meta.url).pathname,
        run: captureCommandRunner(),
        commitState: async () => {
          await ensureRunPidGitignored(stateDir);
          await commitState(stateDir, "ceremony: documentation-gaps");
        },
        notify: desktopNotifier,
      }),
    ],
  );

  return {
    stateDir,
    concurrency: config.tick.concurrency,
    exit: (code) => Deno.exit(code),
    appendTickLog,
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
          resume: opts.resume,
          includePrinciples: config.tick.principles,
          maxTurns: config.tick.maxTurns,
        }),
      isProcessAlive: (ticketId: string) =>
        isPhaseAlive(join(stateDir, ticketId)),
      writeTicket,
      writePhaseOutput,
      appendLog: appendTicketLog,
      resolveModelConfig: (phase, ticket) =>
        resolvePhaseModel(config, phase, ticket),
      selfReview: (phase, ticketDir, worktreePath) =>
        selfReview({
          phase,
          ticketDir,
          run: captureCommandRunner(),
          worktreePath,
        }),
      readPhaseOutput: async (ticketDir, phase) => {
        const found = await findLatestPhaseOutput(ticketDir);
        if (!found || found.phaseName !== phase) return null;
        return await readTextFile(join(ticketDir, found.filename));
      },
      appendPrinciples: async (sd, ticketId, phase, outputContent) => {
        if (!config.tick.principles) return;
        const extracted = extractPrinciples(outputContent);
        if (!extracted) return;
        const scope = await judgePrinciples(extracted, captureCommandRunner());
        if (scope === null) return;
        const globalPath = join(sd, "principles.md");
        let targetPath: string;
        let relPath: string;
        if (scope === "global") {
          targetPath = globalPath;
          relPath = "principles.md";
        } else {
          const parts = ticketId.split("/");
          const provider = parts[0];
          const projectPath = deriveProjectPath(provider, ticketId);
          if (!projectPath) {
            targetPath = globalPath;
            relPath = "principles.md";
          } else {
            relPath = join("principles", provider, `${projectPath}.md`);
            targetPath = join(sd, relPath);
          }
        }
        let globalContent = "";
        try {
          globalContent = await readTextFile(globalPath);
        } catch {
          // file does not exist yet
        }
        let localContent = "";
        if (targetPath !== globalPath) {
          try {
            localContent = await readTextFile(targetPath);
          } catch {
            // file does not exist yet
          }
        }
        const combinedExisting = [globalContent, localContent]
          .filter(Boolean)
          .join("\n\n");
        const novel = dedupePrinciples(combinedExisting, extracted);
        if (!novel) return;
        const existingTarget = targetPath === globalPath
          ? globalContent
          : localContent;
        const newContent = existingTarget.length > 0
          ? `${existingTarget}\n\n${novel}`
          : novel;
        if (targetPath !== globalPath) {
          await mkdir(dirname(targetPath), { recursive: true });
        }
        await writeTextFile(targetPath, newContent);
        await commitPrinciples(sd, `principles: ${ticketId} ${phase}`, relPath);
      },
      readPhaseExitCode: async (ticketDir, phase) => {
        const pattern = new RegExp(
          `^\\d{8}T\\d{6}-${phase}\\.md\\.exit$`,
        );
        const matches: string[] = [];
        try {
          for await (const entry of readDir(ticketDir)) {
            if (entry.isFile && pattern.test(entry.name)) {
              matches.push(entry.name);
            }
          }
        } catch {
          // dir missing
        }
        if (matches.length === 0) return null;
        matches.sort();
        const content = await readTextFile(
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
      readRunPidBootStamp: async (ticketDir: string) => {
        try {
          const content = await readTextFile(join(ticketDir, "run.pid"));
          const lines = content.trim().split("\n");
          return lines[1] ?? null;
        } catch {
          return null;
        }
      },
      currentBootId: () => bootId(),
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
        writeTextFile(join(dir, ".migrations"), ids.join("\n") + "\n"),
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
      writeTextFile(lastWorkedPath, JSON.stringify(ids)),
    listTickets: () => listTickets(stateDir),
    readTicket: (id) => readTicket(stateDir, id),
    writeTicket: (t) => writeTicket(stateDir, t),
    commitState: async () => {
      await ensureRunPidGitignored(stateDir);
      await commitState(stateDir, `tick: ${Temporal.Now.instant().toString()}`);
      await pushState({ stateDir, runGit, log: appendTickLog });
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
            const currentContent = await readTextFile(targetPath).catch(
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
            await mkdir(
              join(wt.path, ...learning.targetFile.split("/").slice(0, -1)),
              { recursive: true },
            );
            await writeTextFile(targetPath, applied);
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
    preflightGitHubCredentials: () =>
      preflightGitHubCredentials(config, {
        run: async (cmd) => {
          const result = await new Deno.Command(cmd[0], {
            args: cmd.slice(1),
            stdout: "piped",
            stderr: "piped",
          }).output();
          const decoder = new TextDecoder();
          return {
            code: result.code,
            stdout: decoder.decode(result.stdout),
            stderr: decoder.decode(result.stderr),
          };
        },
        fetch,
      }),
    notifyTickFailure: (error: string) =>
      desktopNotifier("Tick failed", error.slice(0, 200)),
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
      : [],
    agentsMdMaxTokens: config.tick.agentsMdMaxTokens,
    writeTickProgress: async (label: string | null) => {
      const path = join(lazyboyDir(), "tick-progress.json");
      if (label === null) {
        try {
          await remove(path);
        } catch {
          // file may not exist
        }
      } else {
        await writeTextFile(path, JSON.stringify({ label }));
      }
    },
  };
}
