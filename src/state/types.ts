export type Phase =
  | "new"
  | "running-intake"
  | "waiting-intake"
  | "running-enrichment"
  | "waiting-enrichment"
  | "running-spec"
  | "waiting-spec"
  | "running-plan"
  | "waiting-plan"
  | "running-implementation"
  | "waiting-diff"
  | "waiting-merge"
  | "done"
  | "needs-attention";

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface TicketState {
  id: string;
  provider: string;
  title: string;
  url: string;
  phase: Phase;
  approved: boolean;
  scope: string[];
  pid?: number;
  worktrees: Record<string, WorktreeInfo>;
  prUrl?: string;
  created: string;
  updated: string;
  body: string;
}

export interface Config {
  github: { repos: string[] };
  state: { dir: string };
  tick: { concurrency: number };
  codebase: { roots: string[] };
  packages: { enabled: string[] };
}
