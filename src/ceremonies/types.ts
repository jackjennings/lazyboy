import type { TicketState } from "../state/types.ts";
import type { LanguageModelRequest } from "../models/types.ts";

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

export interface CeremonyContext {
  now: Temporal.ZonedDateTime;
  stateDir: string;
  ceremonyDir: string;
  outputDir: string;
  config: Record<string, unknown>;
  listTickets(): Promise<string[]>;
  readTicket(id: string): Promise<TicketState>;
  generateText(request: LanguageModelRequest): Promise<string | null>;
  writeOutput(content: string): Promise<void>;
  commitState(): Promise<void>;
  notify(title: string, message: string): Promise<void>;
  log(entry: object): Promise<void>;
}

export type CeremonyModule = (
  context: CeremonyContext,
) => Promise<void> | void;

export const BUILT_IN_CEREMONY_NAMES = ["standup", "documentation-gaps"];
