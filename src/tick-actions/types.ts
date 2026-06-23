import type { TicketState } from "../state/types.ts";

export interface TickAction {
  applies(ticket: TicketState): boolean;
  run(ticket: TicketState, stateDir: string): Promise<TicketState | null>;
}
