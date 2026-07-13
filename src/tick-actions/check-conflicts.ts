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
}

export function checkConflictsAction(deps: CheckConflictsDeps): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return (
        ticket.status !== "needs-attention" &&
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
      const now = new Date().toISOString();

      type ConflictRecord = {
        worktreePath: string;
        branch: string;
        conflictedFiles: string[];
        rebaseStderr: string;
      };

      const conflicts: ConflictRecord[] = [];

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
          if (ticket.prUrl !== undefined) {
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

        await deps.runGit(["rebase", "--abort"], wt.path);

        conflicts.push({
          worktreePath: wt.path,
          branch: wt.branch,
          conflictedFiles,
          rebaseStderr: rebase.stderr,
        });
      }

      if (conflicts.length === 0) return null;

      const updated: TicketState = {
        ...ticket,
        status: "needs-attention",
        updated: now,
      };
      await deps.writeTicket(stateDir, updated);

      for (const c of conflicts) {
        await deps.appendLog(stateDir, ticket.id, {
          event: "conflict-detected",
          context: "checkConflicts",
          worktreePath: c.worktreePath,
          branch: c.branch,
          conflictedFiles: c.conflictedFiles,
          rebaseStderr: c.rebaseStderr,
        });
      }

      return updated;
    },
  };
}
