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
  failingOutput: string;
}

export interface SpawnCITriageDeps {
  getPRChecks: (prUrl: string) => Promise<CIRunResult | null>;
  getPRDiffFiles: (
    prUrl: string,
  ) => Promise<{ filename: string; patch?: string }[]>;
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

export function spawnCITriageAction(
  deps: SpawnCITriageDeps,
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
      const ticketDir = join(stateDir, ticket.id);

      for (const pr of ticket.prs ?? []) {
        if (pr.merged) continue;

        let ciResult: CIRunResult | null;
        try {
          ciResult = await deps.getPRChecks(pr.url);
        } catch (e) {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "spawnCITriage",
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

        let diffFiles: { filename: string; patch?: string }[];
        try {
          diffFiles = await deps.getPRDiffFiles(pr.url);
        } catch (e) {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "spawnCITriage",
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
            context: "spawnCITriage",
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
            context: "spawnCITriage",
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

      return null;
    },
  };
}
