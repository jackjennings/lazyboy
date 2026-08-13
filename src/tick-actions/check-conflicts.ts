import { join } from "@std/path";
import type { TickAction } from "./types.ts";
import type { TicketState } from "../state/types.ts";

export interface CheckConflictsDeps {
  runGit: (
    args: string[],
    cwd: string,
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  isProcessAlive: (ticketId: string) => boolean;
  worktreeExists: (path: string) => boolean;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
  spawn: (opts: {
    worktreePath: string;
    branch: string;
    ticketDir: string;
    contextFile: string;
    conflictedFiles: string[];
    rebaseStderr: string;
    model: string;
    thinking: string;
  }) => Promise<void>;
  writeContextFile: (
    ticketDir: string,
    branch: string,
    content: string,
  ) => Promise<string>;
  resolveModelConfig: (
    ticket: TicketState,
  ) => { model: string; thinking: string };
}

export function sanitizeBranchForFilename(branch: string): string {
  return encodeURIComponent(branch);
}

export function checkConflictsAction(deps: CheckConflictsDeps): TickAction {
  return {
    label: "Checking conflicts",
    applies(ticket: TicketState): boolean {
      return (
        ticket.status !== "needs-attention" &&
        Object.values(ticket.worktrees).some((wt) =>
          deps.worktreeExists(wt.path)
        ) &&
        !deps.isProcessAlive(ticket.id)
      );
    },
    async run(
      ticket: TicketState,
      stateDir: string,
    ): Promise<TicketState | null> {
      const now = Temporal.Now.instant().toString();
      const ticketDir = join(stateDir, ticket.id);

      type ConflictInfo = {
        wt: { path: string; branch: string };
        conflictedFiles: string[];
        rebaseStderr: string;
        contextFilename: string;
      };

      const conflictResults = await Promise.all(
        Object.values(ticket.worktrees)
          .filter((wt) => deps.worktreeExists(wt.path))
          .map(async (wt): Promise<ConflictInfo | null> => {
            const fetch = await deps.runGit(
              ["fetch", "origin", "main"],
              wt.path,
            );
            if (fetch.code !== 0) {
              await deps.appendLog(stateDir, ticket.id, {
                event: "error",
                context: "checkConflicts",
                worktreePath: wt.path,
                stderr: fetch.stderr,
              });
              return null;
            }

            const rebase = await deps.runGit(
              ["rebase", "origin/main"],
              wt.path,
            );

            if (rebase.code === 0) {
              if (ticket.prs !== undefined && ticket.prs.length > 0) {
                const push = await deps.runGit(
                  ["push", "--force-with-lease", "origin", wt.branch],
                  wt.path,
                );
                if (push.code !== 0) {
                  await deps.appendLog(stateDir, ticket.id, {
                    event: "error",
                    context: "checkConflicts",
                    worktreePath: wt.path,
                    pushStderr: push.stderr,
                  });
                } else {
                  await deps.appendLog(stateDir, ticket.id, {
                    event: "branch-pushed",
                    worktreePath: wt.path,
                    branch: wt.branch,
                  });
                }
              }
              return null;
            }

            const diff = await deps.runGit(
              ["diff", "--name-only", "--diff-filter=U"],
              wt.path,
            );
            const conflictedFiles = diff.stdout
              .split("\n")
              .map((f) => f.trim())
              .filter((f) => f.length > 0);

            const safeBranch = sanitizeBranchForFilename(wt.branch);
            const contextContent =
              `# Conflict Context\n\n## Conflicted Files\n\n${
                conflictedFiles.map((f) => `- ${f}`).join("\n")
              }\n\n## Rebase Stderr\n\n\`\`\`\n${rebase.stderr}\n\`\`\`\n`;
            const contextFilename = await deps.writeContextFile(
              ticketDir,
              safeBranch,
              contextContent,
            );

            return {
              wt,
              conflictedFiles,
              rebaseStderr: rebase.stderr,
              contextFilename,
            };
          }),
      );

      const firstConflict = conflictResults.find(
        (r): r is ConflictInfo => r !== null,
      );
      if (!firstConflict) return null;

      const { model, thinking } = deps.resolveModelConfig(ticket);
      await deps.spawn({
        worktreePath: firstConflict.wt.path,
        branch: firstConflict.wt.branch,
        ticketDir,
        contextFile: firstConflict.contextFilename,
        conflictedFiles: firstConflict.conflictedFiles,
        rebaseStderr: firstConflict.rebaseStderr,
        model,
        thinking,
      });

      const updated: TicketState = {
        ...ticket,
        status: "running",
        updated: now,
        phaseSessionIds: ticket.phaseSessionIds
          ? { ...ticket.phaseSessionIds, implementation: undefined }
          : undefined,
      };
      await deps.writeTicket(stateDir, updated);
      await deps.appendLog(stateDir, ticket.id, {
        event: "conflict-resolution-started",
        worktreePath: firstConflict.wt.path,
        branch: firstConflict.wt.branch,
        conflictedFiles: firstConflict.conflictedFiles,
        rebaseStderr: firstConflict.rebaseStderr,
      });
      return updated;
    },
  };
}
