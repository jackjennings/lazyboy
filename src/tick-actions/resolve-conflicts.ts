import { join } from "@std/path";
import type { TickAction } from "./types.ts";
import type { TicketState } from "../state/types.ts";
import { sanitizeBranchForFilename } from "./check-conflicts.ts";
import { deleteRunPid } from "../executor.ts";

export interface ResolveConflictsDeps {
  runGit: (
    args: string[],
    cwd: string,
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  isProcessAlive: (ticketId: string) => boolean;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
  stat: (path: string) => Promise<boolean>;
  readDir: (
    path: string,
  ) => AsyncIterable<{ name: string; isFile: boolean }>;
  remove: (path: string) => Promise<void>;
}

export function resolveConflictsAction(deps: ResolveConflictsDeps): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return (
        ticket.status === "running" &&
        !deps.isProcessAlive(ticket.id)
      );
    },
    async run(
      ticket: TicketState,
      stateDir: string,
    ): Promise<TicketState | null> {
      const ticketDir = join(stateDir, ticket.id);

      const contextFiles: string[] = [];
      try {
        for await (const entry of deps.readDir(ticketDir)) {
          if (
            entry.isFile &&
            entry.name.includes("-conflict-context-") &&
            entry.name.endsWith(".md")
          ) {
            contextFiles.push(join(ticketDir, entry.name));
          }
        }
      } catch {
        // ticketDir not readable
      }

      if (contextFiles.length === 0) return null;

      const resolvingWorktrees = Object.values(ticket.worktrees).filter(
        (wt) => {
          const safeBranch = sanitizeBranchForFilename(wt.branch);
          return contextFiles.some((p) =>
            p.endsWith(`-conflict-context-${safeBranch}.md`)
          );
        },
      );

      const now = Temporal.Now.instant().toString();

      let agentFailed = false;
      for (const wt of resolvingWorktrees) {
        const gitDirResult = await deps.runGit(
          ["rev-parse", "--git-dir"],
          wt.path,
        );
        const gitDirRaw = gitDirResult.stdout.trim();
        const gitDir = gitDirRaw.startsWith("/")
          ? gitDirRaw
          : join(wt.path, gitDirRaw);
        if (await deps.stat(join(gitDir, "REBASE_HEAD"))) {
          agentFailed = true;
          break;
        }
      }

      if (agentFailed) {
        for (const wt of resolvingWorktrees) {
          await deps.runGit(["rebase", "--abort"], wt.path);
        }
        for (const f of contextFiles) {
          await deps.remove(f);
        }
        await deleteRunPid(join(stateDir, ticket.id));
        const updated: TicketState = {
          ...ticket,
          status: "needs-attention",
          updated: now,
        };
        await deps.writeTicket(stateDir, updated);
        for (const wt of resolvingWorktrees) {
          await deps.appendLog(stateDir, ticket.id, {
            event: "conflict-resolution-failed",
            worktreePath: wt.path,
            branch: wt.branch,
            reason: "agent-failed",
          });
        }
        return updated;
      }

      for (const wt of resolvingWorktrees) {
        const push = await deps.runGit(
          ["push", "--force-with-lease", "origin", wt.branch],
          wt.path,
        );
        if (push.code !== 0) {
          for (const f of contextFiles) {
            await deps.remove(f);
          }
          await deleteRunPid(join(stateDir, ticket.id));
          const updated: TicketState = {
            ...ticket,
            status: "needs-attention",
            updated: now,
          };
          await deps.writeTicket(stateDir, updated);
          await deps.appendLog(stateDir, ticket.id, {
            event: "conflict-resolution-failed",
            worktreePath: wt.path,
            branch: wt.branch,
            reason: "push-failed",
          });
          return updated;
        }
      }

      for (const f of contextFiles) {
        await deps.remove(f);
      }
      await deleteRunPid(join(stateDir, ticket.id));
      const updated: TicketState = {
        ...ticket,
        status: "waiting",
        updated: now,
      };
      await deps.writeTicket(stateDir, updated);
      for (const wt of resolvingWorktrees) {
        await deps.appendLog(stateDir, ticket.id, {
          event: "conflict-resolved",
          worktreePath: wt.path,
          branch: wt.branch,
        });
      }
      return updated;
    },
  };
}
