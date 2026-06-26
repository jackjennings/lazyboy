import type { TickAction } from "./types.ts";
import type { TicketState, WorktreeInfo } from "../state/types.ts";
import { extractGitHubSlug } from "../worktree.ts";

export interface CreateWorktreeDeps {
  roots: string[];
  findLocalRepo: (roots: string[], slug: string) => Promise<string | null>;
  createWorktree: (
    repoPath: string,
    ticketId: string,
    slug: string,
  ) => Promise<WorktreeInfo>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
}

export function createWorktreeAction(deps: CreateWorktreeDeps): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return ticket.status === "new" &&
        Object.keys(ticket.worktrees).length === 0;
    },
    async run(
      ticket: TicketState,
      stateDir: string,
    ): Promise<TicketState | null> {
      const now = new Date().toISOString();
      const slug = extractGitHubSlug(ticket.url);
      const repoPath = await deps.findLocalRepo(deps.roots, slug);
      if (!repoPath) {
        const updated = {
          ...ticket,
          phase: "intake" as const,
          status: "needs-attention" as const,
          updated: now,
        };
        await deps.writeTicket(stateDir, updated);
        return updated;
      }
      try {
        const wt = await deps.createWorktree(repoPath, ticket.id, slug);
        const updated = { ...ticket, worktrees: { [slug]: wt }, updated: now };
        await deps.writeTicket(stateDir, updated);
        return updated;
      } catch {
        const updated = {
          ...ticket,
          phase: "intake" as const,
          status: "needs-attention" as const,
          updated: now,
        };
        await deps.writeTicket(stateDir, updated);
        return updated;
      }
    },
  };
}
