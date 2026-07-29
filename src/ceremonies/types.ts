import type { TicketState } from "../state/types.ts";

export interface Ceremony {
  readonly name: string;
  run(now: Temporal.ZonedDateTime, outputDir: string): Promise<void>;
}

export interface StandupCeremonyDeps {
  listTickets(): Promise<string[]>;
  readTicket(id: string): Promise<TicketState>;
  commitState(): Promise<void>;
  notify?: (title: string, message: string) => Promise<void>;
}
