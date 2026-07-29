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
  getPRDiffFiles: (
    prUrl: string,
  ) => Promise<{ filename: string; patch?: string }[]>;
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
  spawn: (opts: {
    worktreePath: string;
    branch: string;
    ticketDir: string;
    contextFile: string;
    prUrl: string;
    repo: string;
    runId: string;
    model: string;
    thinking: string;
  }) => Promise<void>;
  writeContextFile: (
    ticketDir: string,
    runId: string,
    content: string,
  ) => Promise<string>;
  resolveModelConfig: (
    ticket: TicketState,
  ) => { model: string; thinking: string };
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
      const ticketDir = join(stateDir, ticket.id);

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

        const repoMatch = pr.url.match(
          /github\.com\/([^/]+\/[^/]+)\/pull\//,
        );
        const repo = repoMatch ? repoMatch[1] : "unknown/unknown";

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
              anyHandled = true;
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
            anyHandled = true;
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
              anyHandled = true;
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
            anyHandled = true;
          }
        } else {
          let diffFiles: { filename: string; patch?: string }[];
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

          const diffSection = diffFiles
            .map((f) =>
              f.patch
                ? `### ${f.filename}\n\n\`\`\`diff\n${f.patch}\n\`\`\``
                : `### ${f.filename}`
            )
            .join("\n\n");

          const content = `PR-URL: ${pr.url}\n` +
            `Repo: ${repo}\n` +
            `Run-ID: ${ciResult.runId}\n` +
            `Branch: ${worktree?.branch ?? ""}\n` +
            `Worktree-Path: ${worktree?.path ?? ""}\n\n` +
            `## CI Output\n\n${ciResult.failingOutput}\n\n` +
            `## PR Diff\n\n${diffSection}`;

          let contextFile: string;
          try {
            contextFile = await deps.writeContextFile(
              ticketDir,
              ciResult.runId,
              content,
            );
          } catch (e) {
            await deps.appendLog(stateDir, ticket.id, {
              event: "error",
              context: "resolveCIFailures",
              message: String(e),
            });
            handledIds.delete(ciResult.runId);
            continue;
          }

          const { model, thinking } = deps.resolveModelConfig(ticket);
          try {
            await deps.spawn({
              worktreePath: worktree?.path ?? "",
              branch: worktree?.branch ?? "",
              ticketDir,
              contextFile,
              prUrl: pr.url,
              repo,
              runId: ciResult.runId,
              model,
              thinking,
            });
          } catch (e) {
            await deps.appendLog(stateDir, ticket.id, {
              event: "error",
              context: "resolveCIFailures",
              message: String(e),
            });
            handledIds.delete(ciResult.runId);
            continue;
          }

          const now = Temporal.Now.instant().toString();
          const updated: TicketState = {
            ...ticket,
            ciHandledRunIds: [...handledIds],
            updated: now,
          };
          await deps.writeTicket(stateDir, updated);
          return updated;
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
