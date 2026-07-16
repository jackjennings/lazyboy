export type TicketPhase =
  | "intake"
  | "enrichment"
  | "spec"
  | "plan"
  | "implementation"
  | "merge";

export type TicketStatus =
  | "new"
  | "running"
  | "waiting"
  | "revising"
  | "needs-attention"
  | "done";

const VALID_STATUSES: Record<TicketPhase, ReadonlyArray<TicketStatus>> = {
  intake: ["new", "running", "waiting", "revising", "needs-attention"],
  enrichment: ["running", "waiting", "revising", "needs-attention"],
  spec: ["running", "waiting", "revising", "needs-attention"],
  plan: ["running", "waiting", "revising", "needs-attention"],
  implementation: ["running", "waiting", "revising", "needs-attention"],
  merge: ["waiting", "done", "needs-attention"],
};

export function assertValidPhaseStatus(
  phase: TicketPhase,
  status: TicketStatus,
): void {
  if (!(VALID_STATUSES[phase] as TicketStatus[]).includes(status)) {
    throw new Error(
      `Invalid (phase, status) combination: (${phase}, ${status})`,
    );
  }
}

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface TicketState {
  id: string;
  provider: string;
  title: string;
  url: string;
  phase: TicketPhase;
  status: TicketStatus;
  approved: boolean;
  scope: string[];
  pid?: number;
  worktrees: Record<string, WorktreeInfo>;
  prUrl?: string;
  providerDone?: boolean;
  created: string;
  updated: string;
  body: string;
  phases?: Partial<Record<string, { model?: string; thinking?: string }>>;
}

export interface PhaseUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  model: string;
  durationMs: number;
}

export interface Config {
  github: { repos: string[] };
  state: { dir: string };
  tick: { concurrency: number };
  codebase: { roots: string[] };
  packages: { enabled: string[] };
  jira?: { baseUrl: string; project: string };
  phases?: {
    defaults?: Partial<Record<string, { model?: string; thinking?: string }>>;
  };
}
