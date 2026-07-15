import type { TicketState } from "../state/types.ts";

export interface Migration {
  run(ticket: TicketState, stateDir: string): Promise<TicketState>;
}
