import { join } from "@std/path";
import type { TickAction } from "./types.ts";
import {
  ARTIFACT_DESCRIPTORS,
  type PrEntry,
  type TicketState,
} from "../state/types.ts";

export interface ReconcilePRsDeps {
  readImplementationOutput: (ticketDir: string) => Promise<string | null>;
  getPRInfo: (
    url: string,
  ) => Promise<{
    url: string;
    title: string;
    baseRefName: string;
    headRefName: string;
  }>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
}

const PR_URL_RE = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/g;

function extractPRUrls(content: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of content.matchAll(PR_URL_RE)) {
    if (!seen.has(match[0])) {
      seen.add(match[0]);
      urls.push(match[0]);
    }
  }
  return urls;
}

function topoSort(
  infos: Array<{
    url: string;
    title: string;
    baseRefName: string;
    headRefName: string;
  }>,
): typeof infos {
  const headToUrl = new Map(infos.map((p) => [p.headRefName, p.url]));
  const withDepth = infos.map((p) => {
    let depth = 0;
    let base = p.baseRefName;
    const visited = new Set<string>();
    while (headToUrl.has(base) && !visited.has(base)) {
      visited.add(base);
      depth++;
      const parent = infos.find((q) => q.headRefName === base)!;
      base = parent.baseRefName;
    }
    return { info: p, depth };
  });
  withDepth.sort((a, b) => a.depth - b.depth);
  return withDepth.map((x) => x.info);
}

export function reconcilePRsAction(deps: ReconcilePRsDeps): TickAction {
  return {
    label: "Reconciling PRs",
    applies(ticket: TicketState): boolean {
      return (
        ticket.phase === "implementation" &&
        ticket.status === "waiting" &&
        ARTIFACT_DESCRIPTORS[ticket.artifact].requiresPRs &&
        (!ticket.prs || ticket.prs.length === 0)
      );
    },
    async run(
      ticket: TicketState,
      stateDir: string,
    ): Promise<TicketState | null> {
      const now = Temporal.Now.instant().toString();
      const ticketDir = join(stateDir, ticket.id);

      const content = await deps.readImplementationOutput(ticketDir);
      const urls = content ? extractPRUrls(content) : [];

      if (urls.length === 0) {
        const updated: TicketState = {
          ...ticket,
          status: "needs-attention",
          updated: now,
        };
        await deps.writeTicket(stateDir, updated);
        await deps.appendLog(stateDir, ticket.id, {
          event: "needs-attention",
          reason: "no-prs",
        });
        return updated;
      }

      const infos: Array<{
        url: string;
        title: string;
        baseRefName: string;
        headRefName: string;
      }> = [];
      for (const url of urls) {
        try {
          infos.push(await deps.getPRInfo(url));
        } catch (e) {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "reconcilePRs",
            message: String(e),
          });
          const parked: TicketState = {
            ...ticket,
            status: "needs-attention",
            updated: now,
          };
          await deps.writeTicket(stateDir, parked);
          await deps.appendLog(stateDir, ticket.id, {
            event: "needs-attention",
            reason: "pr-fetch-failed",
          });
          return parked;
        }
      }

      const sorted = topoSort(infos);
      const headToUrl = new Map(sorted.map((p) => [p.headRefName, p.url]));

      const prs: PrEntry[] = sorted.map((p) => {
        const slug = p.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1];
        const worktreeKey = slug && ticket.worktrees[slug]
          ? slug
          : Object.entries(ticket.worktrees).find(
            ([, wt]) => wt.branch === p.headRefName,
          )?.[0] ?? Object.keys(ticket.worktrees)[0];
        return {
          url: p.url,
          title: p.title,
          dependsOn: headToUrl.has(p.baseRefName)
            ? [headToUrl.get(p.baseRefName)!]
            : [],
          merged: false,
          worktreeKey,
        };
      });

      const updated: TicketState = { ...ticket, prs, updated: now };
      await deps.writeTicket(stateDir, updated);
      await deps.appendLog(stateDir, ticket.id, {
        event: "reconciled-prs",
        count: prs.length,
      });
      return updated;
    },
  };
}
