import { join } from "@std/path";
import type { TickAction } from "./types.ts";
import type { TicketState } from "../state/types.ts";

export type CIConclusion =
  | "failure"
  | "action_required"
  | "success"
  | "pending";

export interface CIRunResult {
  runId: string;
  conclusion: CIConclusion;
  firstFailingStep: "fmt" | "lint" | "test" | "other";
  failingOutput: string;
  failingFiles: string[];
}

export interface ResolveCIFailuresDeps {
  getPRChecks: (prUrl: string) => Promise<CIRunResult | null>;
  getPRDiffFiles: (prUrl: string) => Promise<string[]>;
  runFmt: (worktreePath: string) => Promise<boolean>;
  runLintFix: (
    worktreePath: string,
  ) => Promise<{ allFixed: boolean; remainingOutput: string }>;
  runGit: (
    args: string[],
    cwd: string,
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  createGitHubIssue: (opts: {
    repo: string;
    title: string;
    body: string;
  }) => Promise<void>;
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<void>;
  isProcessAlive: (ticketId: string) => boolean;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
}

const IMPL_PROMPT_REL = "src/phases/prompts/implementation.md";
const FMT_MARKER = "deno fmt && deno lint";
const FMT_STEP =
  "\n5. Run `deno fmt && deno lint`. Required even when only `.md` files\n" +
  "   changed — `deno fmt` formats Markdown.";

export function resolveCIFailuresAction(
  deps: ResolveCIFailuresDeps,
): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return (
        ticket.prs !== undefined &&
        ticket.prs.some((pr) => !pr.merged) &&
        ticket.status !== "needs-attention" &&
        !deps.isProcessAlive(ticket.id)
      );
    },

    async run(
      ticket: TicketState,
      stateDir: string,
    ): Promise<TicketState | null> {
      const handledIds = new Set(ticket.ciHandledRunIds ?? []);
      let anyHandled = false;

      for (const pr of ticket.prs ?? []) {
        if (pr.merged) continue;

        let ciResult: CIRunResult | null;
        try {
          ciResult = await deps.getPRChecks(pr.url);
        } catch (e) {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "resolveCIFailures",
            message: String(e),
          });
          continue;
        }
        if (!ciResult) continue;
        if (
          ciResult.conclusion !== "failure" &&
          ciResult.conclusion !== "action_required"
        ) {
          continue;
        }
        if (handledIds.has(ciResult.runId)) continue;

        handledIds.add(ciResult.runId);

        let diffFiles: string[];
        try {
          diffFiles = await deps.getPRDiffFiles(pr.url);
        } catch (e) {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "resolveCIFailures",
            message: String(e),
          });
          handledIds.delete(ciResult.runId);
          continue;
        }

        const diffSet = new Set(diffFiles);
        const isPRCaused = ciResult.failingFiles.length > 0 &&
          ciResult.failingFiles.some((f) => diffSet.has(f));

        const repoMatch = pr.url.match(
          /github\.com\/([^/]+\/[^/]+)\/pull\//,
        );
        const repo = repoMatch ? repoMatch[1] : "unknown/unknown";

        if (!isPRCaused) {
          try {
            await deps.createGitHubIssue({
              repo,
              title: `CI infrastructure failure in ${repo}`,
              body:
                `Observed in PR: ${pr.url}\n\nFailing step: ${ciResult.firstFailingStep}\n\n` +
                `This failure was not caused by the PR's changes.\n\n${ciResult.failingOutput}`,
            });
            anyHandled = true;
          } catch (e) {
            await deps.appendLog(stateDir, ticket.id, {
              event: "error",
              context: "resolveCIFailures",
              message: String(e),
            });
            handledIds.delete(ciResult.runId);
          }
          continue;
        }

        anyHandled = true;

        const worktree = pr.worktreeKey
          ? ticket.worktrees[pr.worktreeKey]
          : undefined;

        if (ciResult.firstFailingStep === "fmt") {
          if (!worktree) {
            try {
              await deps.createGitHubIssue({
                repo,
                title: `Fix fmt failure — no worktree available`,
                body:
                  `PR: ${pr.url}\n\nAutomated fix not possible: no worktree.\n\n${ciResult.failingOutput}`,
              });
            } catch (e) {
              await deps.appendLog(stateDir, ticket.id, {
                event: "error",
                context: "resolveCIFailures",
                message: String(e),
              });
            }
          } else {
            let fmtChanged: boolean;
            try {
              fmtChanged = await deps.runFmt(worktree.path);
            } catch (e) {
              await deps.appendLog(stateDir, ticket.id, {
                event: "error",
                context: "resolveCIFailures",
                message: String(e),
              });
              continue;
            }
            if (fmtChanged) {
              await deps.runGit(["add", "-A"], worktree.path);
              await deps.runGit(
                ["commit", "-m", "fix: run deno fmt"],
                worktree.path,
              );
              await deps.runGit(
                ["push", "origin", worktree.branch],
                worktree.path,
              );
              await deps.appendLog(stateDir, ticket.id, {
                event: "ci-fmt-fixed",
                prUrl: pr.url,
                runId: ciResult.runId,
              });
            }
            await applySystemicImprovement(ticket, deps);
          }
        } else if (ciResult.firstFailingStep === "lint") {
          if (!worktree) {
            try {
              await deps.createGitHubIssue({
                repo,
                title: `Fix lint failure — no worktree available`,
                body:
                  `PR: ${pr.url}\n\nAutomated fix not possible: no worktree.\n\n${ciResult.failingOutput}`,
              });
            } catch (e) {
              await deps.appendLog(stateDir, ticket.id, {
                event: "error",
                context: "resolveCIFailures",
                message: String(e),
              });
            }
          } else {
            let lintResult: { allFixed: boolean; remainingOutput: string };
            try {
              lintResult = await deps.runLintFix(worktree.path);
            } catch (e) {
              await deps.appendLog(stateDir, ticket.id, {
                event: "error",
                context: "resolveCIFailures",
                message: String(e),
              });
              continue;
            }
            if (lintResult.allFixed) {
              await deps.runGit(["add", "-A"], worktree.path);
              await deps.runGit(
                ["commit", "-m", "fix: run deno lint --fix"],
                worktree.path,
              );
              await deps.runGit(
                ["push", "origin", worktree.branch],
                worktree.path,
              );
            } else {
              try {
                await deps.createGitHubIssue({
                  repo,
                  title: `Fix lint errors in PR (automated fix incomplete)`,
                  body:
                    `PR: ${pr.url}\n\n\`deno lint --fix\` did not fully resolve all lint errors.\n\n` +
                    `Remaining errors:\n${lintResult.remainingOutput}`,
                });
              } catch (e) {
                await deps.appendLog(stateDir, ticket.id, {
                  event: "error",
                  context: "resolveCIFailures",
                  message: String(e),
                });
              }
            }
          }
        } else if (ciResult.firstFailingStep === "test") {
          const testNameMatch = ciResult.failingOutput.match(
            /FAILED ([^\n]+)/,
          );
          const testName = testNameMatch ? testNameMatch[1].trim() : "unknown";
          try {
            await deps.createGitHubIssue({
              repo,
              title: `Fix failing test: ${testName}`,
              body: `PR branch: ${
                worktree?.branch ?? pr.url
              }\n\nCI output:\n${ciResult.failingOutput}`,
            });
          } catch (e) {
            await deps.appendLog(stateDir, ticket.id, {
              event: "error",
              context: "resolveCIFailures",
              message: String(e),
            });
          }
        } else {
          try {
            await deps.createGitHubIssue({
              repo,
              title: `CI failure on ${pr.url}`,
              body: `PR: ${pr.url}\n\n${ciResult.failingOutput}`,
            });
          } catch (e) {
            await deps.appendLog(stateDir, ticket.id, {
              event: "error",
              context: "resolveCIFailures",
              message: String(e),
            });
          }
        }
      }

      if (!anyHandled) return null;

      const now = Temporal.Now.instant().toString();
      const updated: TicketState = {
        ...ticket,
        ciHandledRunIds: [...handledIds],
        updated: now,
      };
      await deps.writeTicket(stateDir, updated);
      return updated;
    },
  };
}

async function applySystemicImprovement(
  ticket: TicketState,
  deps: ResolveCIFailuresDeps,
): Promise<void> {
  const lazyboyWt = ticket.worktrees["jackjennings/lazyboy"];
  if (!lazyboyWt) return;
  const implPath = join(lazyboyWt.path, IMPL_PROMPT_REL);
  const content = await deps.readFile(implPath);
  if (content === null || content.includes(FMT_MARKER)) return;
  const updated = content.replace(
    "4. Confirm all tests pass",
    `4. Confirm all tests pass${FMT_STEP}`,
  );
  await deps.writeFile(implPath, updated);
  await deps.runGit(["add", IMPL_PROMPT_REL], lazyboyWt.path);
  await deps.runGit(
    ["commit", "-m", "docs: add deno fmt step to implementation prompt"],
    lazyboyWt.path,
  );
}
