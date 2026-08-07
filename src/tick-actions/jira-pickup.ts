import type { TickAction } from "./types.ts";
import type { TicketState } from "../state/types.ts";
import { jiraTransition } from "./jira-transition.ts";
import { HttpClient } from "../http-client.ts";

export interface JiraPickupDeps {
  baseUrl: string;
  email: string;
  apiToken: string;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
  http: HttpClient;
}

export function jiraPickupAction(opts: JiraPickupDeps): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return ticket.provider === "jira" && ticket.status === "new";
    },
    async run(
      ticket: TicketState,
      stateDir: string,
    ): Promise<TicketState | null> {
      const issueKey = ticket.id.replace(/^jira\//, "");
      try {
        await jiraTransition({
          baseUrl: opts.baseUrl,
          email: opts.email,
          apiToken: opts.apiToken,
          issueKey,
          targetStatusCategoryKey: "in-progress",
          http: opts.http,
        });
      } catch (e) {
        await opts.appendLog(stateDir, ticket.id, {
          event: "error",
          context: "jiraPickup",
          message: String(e),
        });
      }
      return null;
    },
  };
}
