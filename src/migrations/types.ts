import type { TicketState } from "../state/types.ts";

export interface Migration {
  run(ticket: TicketState): Promise<TicketState>;
}
