import type { TicketState } from "../state/types.ts";

export interface Migration {
  type?: never;
  run(ticket: TicketState, stateDir: string): Promise<TicketState>;
}

export interface StoreMigration {
  type: "store";
  run(stateDir: string): Promise<void>;
}
