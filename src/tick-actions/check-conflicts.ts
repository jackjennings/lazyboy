import { join } from "@std/path";
import type { TickAction } from "./types.ts";
import type { TicketState } from "../state/types.ts";

export interface CheckConflictsDeps {
  runGit: (
    args: string[],
    cwd: string,
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  isPidAlive: (pid: number) => boolean;
  worktreeExists: (path: string) => boolean;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
  spawn: (opts: {
    worktreePath: string;
    branch: string;
    ticketDir: string;
    conflictedFiles: string[];
    rebaseStderr: string;
  }) => Promise<number>;
  writeContextFile: (
    ticketDir: string,
    branch: string,
    content: string,
  ) => Promise<void>;
}

export function sanitizeBranchForFilename(branch: string): string {
  return encodeURIComponent(branch);
}

export function checkConflictsAction(deps: CheckConflictsDeps): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return (
        ticket.status !== "needs-attention" &&
        ticket.phase !== "merge" &&
        Object.values(ticket.worktrees).some((wt) =>
          deps.worktreeExists(wt.path)
        ) &&
        !(ticket.pid !== undefined && deps.isPidAlive(ticket.pid))
      );
    },
    async run(
      ticket: TicketState,
      stateDir: string,
    ): Promise<TicketState | null> {
      const now = Temporal.Now.instant().toString();

      for (const wt of Object.values(ticket.worktrees)) {
        if (!deps.worktreeExists(wt.path)) continue;
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
          continue;
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
                event: "success",
                context: "checkConflicts",
                worktreePath: wt.path,
                branch: wt.branch,
              });
            }
          }
          continue;
        }

        const diff = await deps.runGit(
          ["diff", "--name-only", "--diff-filter=U"],
          wt.path,
        );
        const conflictedFiles = diff.stdout
          .split("\n")
          .map((f) => f.trim())
          .filter((f) => f.length > 0);

        const ticketDir = join(stateDir, ticket.id);
        const safeBranch = sanitizeBranchForFilename(wt.branch);
        const contextContent = `# Conflict Context\n\n## Conflicted Files\n\n${
          conflictedFiles.map((f) => `- ${f}`).join("\n")
        }\n\n## Rebase Stderr\n\n\`\`\`\n${rebase.stderr}\n\`\`\`\n`;
        await deps.writeContextFile(ticketDir, safeBranch, contextContent);

        const pid = await deps.spawn({
          worktreePath: wt.path,
          branch: wt.branch,
          ticketDir,
          conflictedFiles,
          rebaseStderr: rebase.stderr,
        });

        const updated: TicketState = {
          ...ticket,
          status: "running",
          pid,
          updated: now,
        };
        await deps.writeTicket(stateDir, updated);
        await deps.appendLog(stateDir, ticket.id, {
          event: "conflict-resolution-started",
          worktreePath: wt.path,
          branch: wt.branch,
          conflictedFiles,
          rebaseStderr: rebase.stderr,
        });
        return updated;
      }

      return null;
    },
  };
}
