import type { TickAction } from "./types.ts";
import type { TicketState, WorktreeInfo } from "../state/types.ts";

export interface CheckMergedPRDeps {
  isPRMerged: (prUrl: string) => Promise<boolean>;
  cleanupWorktree: (wt: WorktreeInfo) => Promise<void>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
}

export function checkMergedPRAction(deps: CheckMergedPRDeps): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return ticket.phase === "waiting-merge" && ticket.prUrl !== undefined;
    },
    async run(ticket: TicketState, stateDir: string): Promise<TicketState | null> {
      let merged: boolean;
      try {
        merged = await deps.isPRMerged(ticket.prUrl!);
      } catch (e) {
        console.error(`checkMergedPR: GitHub API error for ${ticket.id}:`, e);
        return null;
      }

      if (!merged) return null;

      const now = new Date().toISOString();
      for (const wt of Object.values(ticket.worktrees)) {
        try {
          await deps.cleanupWorktree(wt);
        } catch (e) {
          console.error(`checkMergedPR: cleanup failed for ${ticket.id}:`, e);
        }
      }

      const updated = { ...ticket, phase: "done" as const, updated: now };
      await deps.writeTicket(stateDir, updated);
      return updated;
    },
  };
}
