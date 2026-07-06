import type { TickAction } from "./types.ts";
import type { TicketState } from "../state/types.ts";
import { jiraTransition } from "./jira-transition.ts";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface JiraDoneDeps {
  baseUrl: string;
  email: string;
  apiToken: string;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
  _fetch?: FetchFn;
}

export function jiraDoneAction(opts: JiraDoneDeps): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return (
        ticket.provider === "jira" &&
        ticket.phase === "merge" &&
        ticket.status === "done" &&
        !ticket.providerDone
      );
    },
    async run(
      ticket: TicketState,
      stateDir: string,
    ): Promise<TicketState | null> {
      const issueKey = ticket.id.replace(/^jira-/, "");
      try {
        await jiraTransition({
          baseUrl: opts.baseUrl,
          email: opts.email,
          apiToken: opts.apiToken,
          issueKey,
          targetStatusCategoryKey: "done",
          fetch: opts._fetch,
        });
      } catch (e) {
        await opts.appendLog(stateDir, ticket.id, {
          event: "error",
          context: "jiraDone",
          message: String(e),
        });
        return null;
      }
      const updated: TicketState = { ...ticket, providerDone: true };
      await opts.writeTicket(stateDir, updated);
      return updated;
    },
  };
}
