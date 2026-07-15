export type PhaseRunner = (ticketDir: string) => Promise<void>;

export const PHASE_SEQUENCE = [
  "intake",
  "enrichment",
  "spec",
  "plan",
  "implementation",
] as const;

export const FULL_PHASE_SEQUENCE = [
  ...PHASE_SEQUENCE,
  "merge",
] as const;

export type ActivePhase = typeof PHASE_SEQUENCE[number];
