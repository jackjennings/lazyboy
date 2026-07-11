import { existsSync } from "@std/fs";
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
import { JiraProvider } from "./providers/jira.ts";
import { jiraPickupAction } from "./tick-actions/jira-pickup.ts";
import { jiraDoneAction } from "./tick-actions/jira-done.ts";
import { isPidAlive as defaultIsPidAlive, spawnPhase } from "./executor.ts";
import { loadPrompt, nextPhase, outputFileForPhase } from "./phases/runners.ts";
import { createWorktree, findLocalRepo, runGit } from "./worktree.ts";
import { createWorktreeAction } from "./tick-actions/create-worktree.ts";
import { checkMergedPRAction } from "./tick-actions/check-merged-pr.ts";
import { checkConflictsAction } from "./tick-actions/check-conflicts.ts";
import {
  installPackages,
  isPackageInstalled,
  runPiInstall,
} from "./packages.ts";
import {
  createMigrationRunner,
  type MigrationFn,
} from "./migrations/runner.ts";
import type { Migration } from "./migrations/types.ts";
import type { TickAction } from "./tick-actions/types.ts";
import type { Config, TicketState, WorktreeInfo } from "./state/types.ts";
import type { ActivePhase } from "./phases/types.ts";
import type { InstallResult } from "./packages.ts";

export interface TickOrchestrationDeps {
  loadConfig: () => Promise<Config>;
  installPackages: (sources: string[]) => Promise<InstallResult[]>;
  advanceTickets: (config: Config) => Promise<void>;
  isPidAlive?: (pid: number) => boolean;
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
  const zonedNow = Temporal.Now.zonedDateTimeISO("UTC");
  const now = zonedNow.toInstant().toString();

  if (ticket.status === "revising") {
    const activePhase = ticket.phase as ActivePhase;
    const dt = zonedNow.toPlainDateTime();
    const timestamp = dt.toPlainDate().toString() +
      "T" +
      String(dt.hour).padStart(2, "0") +
      String(dt.minute).padStart(2, "0") +
      String(dt.second).padStart(2, "0");
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

export async function advanceTicketsImpl(
  config: Config,
  runMigrations?: MigrationFn,
): Promise<void> {
  const stateDir = expandHome(config.state.dir);
  const migrationsDir = new URL("../migrations", import.meta.url).pathname;

  const resolvedRunMigrations = runMigrations ?? createMigrationRunner({
    listMigrationFiles: async () => {
      const files: string[] = [];
      try {
        for await (const entry of Deno.readDir(migrationsDir)) {
          if (entry.isFile && /^\d+-[a-z0-9-]+\.ts$/.test(entry.name)) {
            files.push(entry.name);
          }
        }
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
      return files.sort();
    },
    loadMigration: async (id: string): Promise<Migration> => {
      const module = await import(join(migrationsDir, id));
      return module.default;
    },
    readApplied: async (dir: string) => {
      try {
        const content = await Deno.readTextFile(join(dir, ".migrations"));
        return content.split("\n").filter((l) => l.length > 0);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return [];
        throw e;
      }
    },
    writeApplied: (dir: string, ids: string[]) =>
      Deno.writeTextFile(join(dir, ".migrations"), ids.join("\n") + "\n"),
    writeTicket,
  });

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
      created: Temporal.Now.instant().toString(),
      updated: Temporal.Now.instant().toString(),
      body: item.description,
    });
  }

  if (config.jira) {
    const jiraEmail = Deno.env.get("JIRA_EMAIL") ?? "";
    const jiraApiToken = Deno.env.get("JIRA_API_TOKEN") ?? "";
    const jiraProvider = new JiraProvider({
      baseUrl: config.jira.baseUrl,
      email: jiraEmail,
      apiToken: jiraApiToken,
      project: config.jira.project,
    });
    const newJiraItems = await jiraProvider.fetchNew(existingIds);
    for (const item of newJiraItems) {
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
        created: Temporal.Now.instant().toString(),
        updated: Temporal.Now.instant().toString(),
        body: item.description,
      });
    }
  }

  const maxRunning = config.tick.concurrency;
  const ids = await listTickets(stateDir);
  const tickets = await Promise.all(
    ids.map((id) => readTicket(stateDir, id)),
  );

  const migratedTickets = await resolvedRunMigrations(stateDir, tickets);

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
    checkConflictsAction({
      runGit,
      isPidAlive: defaultIsPidAlive,
      worktreeExists: existsSync,
      writeTicket,
      appendLog: appendTicketLog,
    }),
    ...(config.jira
      ? [
        jiraPickupAction({
          baseUrl: config.jira.baseUrl,
          email: Deno.env.get("JIRA_EMAIL") ?? "",
          apiToken: Deno.env.get("JIRA_API_TOKEN") ?? "",
          appendLog: appendTicketLog,
        }),
        jiraDoneAction({
          baseUrl: config.jira.baseUrl,
          email: Deno.env.get("JIRA_EMAIL") ?? "",
          apiToken: Deno.env.get("JIRA_API_TOKEN") ?? "",
          writeTicket,
          appendLog: appendTicketLog,
        }),
      ]
      : []),
  ];

  const processedTickets = [...migratedTickets];
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

  await commitState(stateDir, `tick: ${Temporal.Now.instant().toString()}`);
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
      if (!isNaN(pid) && (d.isPidAlive ?? defaultIsPidAlive)(pid)) {
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
