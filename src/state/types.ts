import { FULL_PHASE_SEQUENCE } from "../phases/types.ts";

export type TicketPhase = typeof FULL_PHASE_SEQUENCE[number];

export type TicketStatus =
  | "new"
  | "running"
  | "waiting"
  | "revising"
  | "needs-attention"
  | "done";

export const STATUS_SEQUENCE = [
  "new",
  "running",
  "waiting",
  "revising",
  "needs-attention",
  "done",
] as const;

const VALID_STATUSES: Record<TicketPhase, ReadonlyArray<TicketStatus>> = {
  intake: ["new", "running", "waiting", "revising", "needs-attention"],
  enrichment: ["running", "waiting", "revising", "needs-attention"],
  spec: ["running", "waiting", "revising", "needs-attention"],
  plan: ["running", "waiting", "revising", "needs-attention"],
  implementation: ["running", "waiting", "revising", "needs-attention"],
  merge: ["waiting", "done", "needs-attention"],
  "wont-do": ["done"],
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

export interface PrEntry {
  url: string;
  title: string;
  dependsOn: string[];
  merged: boolean;
  worktreeKey?: string;
}

export interface ApprovalEntry {
  timestamp: string;
  actor: "human" | "agent" | "unknown";
  phase: TicketPhase;
}

export interface TicketState {
  id: string;
  provider: string;
  title: string;
  url: string;
  phase: TicketPhase;
  status: TicketStatus;
  approvals: ApprovalEntry[];
  scope: string[];
  worktrees: Record<string, WorktreeInfo>;
  prs?: PrEntry[];
  ciHandledRunIds?: string[];
  providerDone?: boolean;
  created: string;
  updated: string;
  body: string;
  phases?: PhaseModelConfig;
}

export function isApproved(ticket: TicketState): boolean {
  const last = ticket.approvals.at(-1);
  if (!last) return false;
  return last.phase === ticket.phase;
}

export type PhaseModelConfig = Partial<
  Record<string, { model?: string; thinking?: string }>
>;

export interface PhaseUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  model: string;
  durationMs: number;
  turns?: number;
  costUsd?: number;
  tools?: Record<string, number>;
}

export interface Config {
  github: {
    repos: string[];
    accounts?: Record<string, { tokenEnv: string; login: string }>;
    orgs?: Record<string, string>;
  };
  state: { dir: string };
  tick: { concurrency: number; resolveCIFailures: boolean };
  codebase: { roots: string[] };
  packages: { enabled: string[] };
  pi: { provider: string };
  agent: { type: "pi" | "claude-code" };
  jira?: { baseUrl: string; project: string };
  phases?: {
    defaults?: PhaseModelConfig;
  };
}
