import { join } from "@std/path";
import {
  appendTicketLog,
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
import {
  installPackages,
  isPackageInstalled,
  runPiInstall,
} from "./packages.ts";
import type { TickAction } from "./tick-actions/types.ts";
import type { Config, TicketState, WorktreeInfo } from "./state/types.ts";
import type { ActivePhase } from "./phases/types.ts";
import type { InstallResult } from "./packages.ts";

export interface TickOrchestrationDeps {
  loadConfig: () => Promise<Config>;
  installPackages: (sources: string[]) => Promise<InstallResult[]>;
  advanceTickets: (config: Config) => Promise<void>;
}

export interface TickDeps {
  spawn: (
    opts: {
      phase: ActivePhase;
      ticketDir: string;
      prompt: string;
      scope: string[];
      worktrees: Record<string, WorktreeInfo>;
      outputFile?: string;
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
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
}

export async function advancePhase(
  ticket: TicketState,
  stateDir: string,
  deps: TickDeps,
): Promise<void> {
  const now = new Date().toISOString();

  if (ticket.status === "revising") {
    const activePhase = ticket.phase as ActivePhase;
    const isoNow = new Date().toISOString();
    const timestamp = isoNow.slice(0, 4) + isoNow.slice(5, 7) +
      isoNow.slice(8, 10) +
      "T" + isoNow.slice(11, 13) + isoNow.slice(14, 16) + isoNow.slice(17, 19);
    const outputFile = `${activePhase}-${timestamp}.md`;
    const prompt = await loadPrompt(activePhase);
    const pid = await deps.spawn({
      phase: activePhase,
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: ticket.scope,
      worktrees: {},
      outputFile,
    });
    await deps.writeTicket(stateDir, {
      ...ticket,
      status: "running",
      approved: false,
      pid,
      updated: now,
    });
    await deps.appendLog(stateDir, ticket.id, {
      event: "status-transition",
      phase: ticket.phase,
      from: "revising",
      to: "running",
    });
    return;
  }

  if (ticket.status === "new") {
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
      phase: "intake",
      status: "running",
      pid,
      approved: false,
      updated: now,
    });
    await deps.appendLog(stateDir, ticket.id, {
      event: "status-transition",
      phase: "intake",
      from: "new",
      to: "running",
    });
    return;
  }

  if (ticket.status === "running") {
    if (ticket.pid !== undefined && !deps.isPidAlive(ticket.pid)) {
      if (ticket.phase === "implementation") {
        await deps.writeTicket(stateDir, {
          ...ticket,
          phase: "diff",
          status: "waiting",
          pid: undefined,
          updated: now,
        });
        await deps.appendLog(stateDir, ticket.id, {
          event: "phase-transition",
          from: ticket.phase,
          to: "diff",
        });
      } else {
        await deps.writeTicket(stateDir, {
          ...ticket,
          status: "waiting",
          pid: undefined,
          updated: now,
        });
        await deps.appendLog(stateDir, ticket.id, {
          event: "status-transition",
          phase: ticket.phase,
          from: "running",
          to: "waiting",
        });
      }
    }
    return;
  }

  if (
    ticket.phase === "diff" && ticket.status === "waiting" && ticket.approved
  ) {
    await deps.writeTicket(stateDir, {
      ...ticket,
      phase: "merge",
      status: "waiting",
      approved: false,
      updated: now,
    });
    await deps.appendLog(stateDir, ticket.id, {
      event: "phase-transition",
      from: ticket.phase,
      to: "merge",
    });
    return;
  }

  const activePhases: ActivePhase[] = ["intake", "enrichment", "spec", "plan"];
  if (
    ticket.status === "waiting" &&
    ticket.approved &&
    (activePhases as string[]).includes(ticket.phase)
  ) {
    const activePhase = ticket.phase as ActivePhase;
    const next = nextPhase(activePhase);
    if (next === "done") return;
    if (
      next === "implementation" && Object.keys(ticket.worktrees).length === 0
    ) {
      await deps.writeTicket(stateDir, {
        ...ticket,
        phase: "implementation",
        status: "needs-attention",
        approved: false,
        updated: now,
      });
      await deps.appendLog(stateDir, ticket.id, {
        event: "phase-transition",
        from: ticket.phase,
        to: "needs-attention",
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
      phase: next,
      status: "running",
      approved: false,
      pid,
      updated: now,
    });
    await deps.appendLog(stateDir, ticket.id, {
      event: "phase-transition",
      from: ticket.phase,
      to: next,
    });
    return;
  }
}

async function advanceTicketsImpl(config: Config): Promise<void> {
  const stateDir = expandHome(config.state.dir);

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
      phase: "intake",
      status: "new",
      approved: false,
      scope: [],
      worktrees: {},
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      body: item.description,
    });
  }

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
      appendLog: appendTicketLog,
    }),
  ];

  const processedTickets = [...tickets];
  for (let i = 0; i < processedTickets.length; i++) {
    for (const action of tickActions) {
      if (action.applies(processedTickets[i])) {
        const updated = await action.run(processedTickets[i], stateDir);
        if (updated !== null) processedTickets[i] = updated;
      }
    }
  }

  let running = processedTickets.filter((t) => t.status === "running").length;

  for (const ticket of processedTickets) {
    if (
      ticket.status === "done" ||
      ticket.status === "needs-attention" ||
      (ticket.phase === "merge" && ticket.status === "waiting")
    ) continue;

    const willSpawn = ticket.status === "new" ||
      ticket.status === "revising" ||
      (ticket.status === "waiting" && ticket.phase !== "diff" &&
        ticket.approved);
    if (willSpawn && running >= maxRunning) continue;
    if (willSpawn) running++;

    await advancePhase(ticket, stateDir, {
      spawn: (opts) =>
        Promise.resolve(spawnPhase({
          ticketDir: opts.ticketDir,
          prompt: opts.prompt,
          scopeDirs: opts.scope.map(expandHome),
          outputFile: opts.outputFile ?? outputFileForPhase(opts.phase),
          githubToken: token,
          anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
          worktrees: opts.worktrees,
        })),
      isPidAlive: defaultIsPidAlive,
      writeTicket,
      writePhaseOutput,
      appendLog: appendTicketLog,
    });
  }

  await commitState(stateDir, `tick: ${new Date().toISOString()}`);
}

function defaultTickDeps(): TickOrchestrationDeps {
  return {
    loadConfig,
    installPackages: (sources) =>
      installPackages(sources, {
        run: runPiInstall,
        isInstalled: isPackageInstalled,
      }),
    advanceTickets: advanceTicketsImpl,
  };
}

export async function tick(
  deps?: TickOrchestrationDeps,
): Promise<void> {
  const d = deps ?? defaultTickDeps();
  const config = await d.loadConfig();
  const pidFile = join(Deno.env.get("HOME")!, ".lazyboy", "tick.pid");

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
    await d.installPackages(config.packages.enabled);
    await d.advanceTickets(config);
  } finally {
    await Deno.remove(pidFile).catch(() => {});
  }
}
