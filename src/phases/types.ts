export type PhaseRunner = (ticketDir: string) => Promise<void>;

export const PHASE_OUTPUT_FILE: Record<string, string> = {
  intake: "intake.md",
  enrichment: "enrichment.md",
  spec: "spec.md",
  plan: "plan.md",
  implementation: "diff.md",
};

export const PHASE_SEQUENCE = [
  "intake",
  "enrichment",
  "spec",
  "plan",
  "implementation",
] as const;

export const FULL_PHASE_SEQUENCE = [
  ...PHASE_SEQUENCE,
  "diff",
  "merge",
] as const;

export type ActivePhase = typeof PHASE_SEQUENCE[number];
