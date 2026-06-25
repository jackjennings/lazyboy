import { join } from "@std/path";
import {
  commitState,
  listTickets,
  readTicket,
  writePhaseOutput,
  writeTicket,
} from "./state/store.ts";
import { expandHome, loadConfig } from "./config.ts";
import { GitHubProvider } from "./providers/github.ts";
import { isPidAlive as defaultIsPidAlive, spawnPhase } from "./executor.ts";
import { loadPrompt, nextPhase, outputFileForPhase } from "./phases/runners.ts";
import { createWorktree, findLocalRepo } from "./worktree.ts";
import { createWorktreeAction } from "./tick-actions/create-worktree.ts";
import { checkMergedPRAction } from "./tick-actions/check-merged-pr.ts";
import type { TickAction } from "./tick-actions/types.ts";
import type { Phase, TicketState, WorktreeInfo } from "./state/types.ts";
import type { ActivePhase } from "./phases/types.ts";

export interface TickDeps {
  spawn: (
    opts: {
      phase: ActivePhase;
      ticketDir: string;
      prompt: string;
      scope: string[];
      worktrees: Record<string, WorktreeInfo>;
    },
  ) => Promise<number>;
  isPidAlive: (pid: number) => boolean;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  writePhaseOutput: (
    stateDir: string,
    id: string,
    file: string,
    content: string,
  ) => Promise<void>;
}

const ACTIVE_PHASES: ActivePhase[] = [
  "intake",
  "enrichment",
  "spec",
  "plan",
  "implementation",
];

function runningPhaseToWaiting(phase: Phase): Phase | null {
  // Special case: running-implementation → waiting-diff (not waiting-implementation)
  if (phase === "running-implementation") return "waiting-diff";
  const m = phase.match(/^running-(.+)$/);
  if (!m) return null;
  const candidate = m[1];
  if (ACTIVE_PHASES.includes(candidate as ActivePhase)) {
    return `waiting-${candidate}` as Phase;
  }
  return null;
}

function waitingPhaseToActive(phase: Phase): ActivePhase | null {
  const m = phase.match(/^waiting-(.+)$/);
  if (!m) return null;
  const candidate = m[1] as ActivePhase;
  return ACTIVE_PHASES.includes(candidate) ? candidate : null;
}

export async function advancePhase(
  ticket: TicketState,
  stateDir: string,
  deps: TickDeps,
): Promise<void> {
  const now = new Date().toISOString();

  if (ticket.phase === "new") {
    const prompt = await loadPrompt("intake");
    const pid = await deps.spawn({
      phase: "intake",
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: [],
      worktrees: {},
    });
    await deps.writeTicket(stateDir, {
      ...ticket,
      phase: "running-intake",
      pid,
      updated: now,
    });
    return;
  }

  const waitingPhase = runningPhaseToWaiting(ticket.phase);
  if (waitingPhase !== null) {
    if (ticket.pid !== undefined && !deps.isPidAlive(ticket.pid)) {
      await deps.writeTicket(stateDir, {
        ...ticket,
        phase: waitingPhase,
        pid: undefined,
        updated: now,
      });
    }
    return;
  }

  // waiting-diff + approved → waiting-merge
  if (ticket.phase === "waiting-diff" && ticket.approved) {
    await deps.writeTicket(stateDir, {
      ...ticket,
      phase: "waiting-merge",
      approved: false,
      updated: now,
    });
    return;
  }

  const activePhase = waitingPhaseToActive(ticket.phase);
  if (activePhase !== null && ticket.approved) {
    const next = nextPhase(activePhase);
    if (next === "done") {
      // Should not happen for known phases before implementation, but handle gracefully
      await deps.writeTicket(stateDir, {
        ...ticket,
        phase: "waiting-merge",
        approved: false,
        updated: now,
      });
      return;
    }
    if (
      next === "implementation" && Object.keys(ticket.worktrees).length === 0
    ) {
      await deps.writeTicket(stateDir, {
        ...ticket,
        phase: "needs-attention",
        approved: false,
        updated: now,
      });
      return;
    }
    const prompt = await loadPrompt(next);
    const pid = await deps.spawn({
      phase: next,
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: ticket.scope,
      worktrees: next === "implementation" ? ticket.worktrees : {},
    });
    await deps.writeTicket(stateDir, {
      ...ticket,
      phase: `running-${next}` as Phase,
      approved: false,
      pid,
      updated: now,
    });
    return;
  }
}

export async function tick(): Promise<void> {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const pidFile = join(Deno.env.get("HOME")!, ".lazyboy", "tick.pid");

  // Acquire lock
  try {
    const existing = await Deno.readTextFile(pidFile).catch(() => null);
    if (existing) {
      const pid = parseInt(existing.trim(), 10);
      if (!isNaN(pid) && defaultIsPidAlive(pid)) {
        console.log(`tick already running (pid ${pid}), exiting`);
        return;
      }
    }
    await Deno.mkdir(join(Deno.env.get("HOME")!, ".lazyboy"), {
      recursive: true,
    });
    await Deno.writeTextFile(pidFile, String(Deno.pid));
  } catch (e) {
    console.error("Failed to acquire lock:", e);
    return;
  }

  try {
    // Fetch new work
    const token = Deno.env.get("GITHUB_TOKEN") ?? "";
    const login = Deno.env.get("GITHUB_LOGIN") ?? "";
    const provider = new GitHubProvider({
      repos: config.github.repos,
      token,
      login,
    });
    const existingIds = new Set(await listTickets(stateDir));
    const newItems = await provider.fetchNew(existingIds);

    for (const item of newItems) {
      await writeTicket(stateDir, {
        id: item.id,
        provider: item.provider,
        title: item.title,
        url: item.url,
        phase: "new",
        approved: false,
        scope: [],
        worktrees: {},
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        body: item.description,
      });
    }

    // Advance tickets
    const maxRunning = config.tick.concurrency;
    const ids = await listTickets(stateDir);
    const tickets = await Promise.all(
      ids.map((id) => readTicket(stateDir, id)),
    );

    const tickActions: TickAction[] = [
      createWorktreeAction({
        roots: config.codebase.roots.map(expandHome),
        findLocalRepo,
        createWorktree,
        writeTicket,
      }),
      checkMergedPRAction({
        isPRMerged: async (prUrl: string) => {
          const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
          if (!match) throw new Error(`Cannot parse PR URL: ${prUrl}`);
          const [, slug, number] = match;
          const res = await fetch(
            `https://api.github.com/repos/${slug}/pulls/${number}/merge`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
              },
            },
          );
          if (res.status === 204) return true;
          if (res.status === 404) return false;
          throw new Error(
            `Unexpected GitHub API status: ${res.status} for ${prUrl}`,
          );
        },
        cleanupWorktree: async (wt) => {
          const result = await new Deno.Command("git", {
            args: ["rev-parse", "--git-common-dir"],
            cwd: wt.path,
          }).output();
          const gitDir = new TextDecoder().decode(result.stdout).trim();
          const mainRepoPath = gitDir.replace(/[/\\]\.git$/, "");
          await new Deno.Command("git", {
            args: ["worktree", "remove", wt.path],
            cwd: mainRepoPath,
          }).output();
          await new Deno.Command("git", {
            args: ["branch", "-D", wt.branch],
            cwd: mainRepoPath,
          }).output();
        },
        writeTicket,
      }),
    ];

    // Action pass
    const processedTickets = [...tickets];
    for (let i = 0; i < processedTickets.length; i++) {
      for (const action of tickActions) {
        if (action.applies(processedTickets[i])) {
          const updated = await action.run(processedTickets[i], stateDir);
          if (updated !== null) processedTickets[i] = updated;
        }
      }
    }

    // Advance pass
    let running = processedTickets.filter((t) =>
      t.phase.startsWith("running-")
    ).length;

    for (const ticket of processedTickets) {
      if (
        ["needs-attention", "done", "waiting-merge"].includes(ticket.phase)
      ) continue;

      const willSpawn = ticket.phase === "new" ||
        (ticket.phase.startsWith("waiting-") &&
          ticket.phase !== "waiting-diff" && ticket.approved);
      if (willSpawn && running >= maxRunning) continue;
      if (willSpawn) running++;

      await advancePhase(ticket, stateDir, {
        spawn: async (opts) =>
          spawnPhase({
            ticketDir: opts.ticketDir,
            prompt: opts.prompt,
            scopeDirs: opts.scope.map(expandHome),
            outputFile: outputFileForPhase(opts.phase),
            githubToken: token,
            anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
            worktrees: opts.worktrees,
          }),
        isPidAlive: defaultIsPidAlive,
        writeTicket,
        writePhaseOutput,
      });
    }

    await commitState(stateDir, `tick: ${new Date().toISOString()}`);
  } finally {
    await Deno.remove(pidFile).catch(() => {});
  }
}
