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
import { loadPrompt, loadPromptFile, nextPhase } from "./phases/runners.ts";
import { compactTimestamp } from "./timestamp.ts";
import { createWorktree, findLocalRepo, runGit } from "./worktree.ts";
import { createWorktreeAction } from "./tick-actions/create-worktree.ts";
import { checkMergedPRAction } from "./tick-actions/check-merged-pr.ts";
import {
  checkConflictsAction,
  sanitizeBranchForFilename,
} from "./tick-actions/check-conflicts.ts";
import { resolveConflictsAction } from "./tick-actions/resolve-conflicts.ts";
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
import { selfReview } from "./self-review.ts";

export interface AdvanceTicketsDeps {
  readLastWorked: () => Promise<string[]>;
  writeLastWorked: (ids: string[]) => Promise<void>;
  runMigrations: MigrationFn;
}

export interface TickOrchestrationDeps {
  loadConfig: () => Promise<Config>;
  installPackages: (sources: string[]) => Promise<InstallResult[]>;
  advanceTickets: (config: Config) => Promise<void>;
  isPidAlive?: (pid: number) => boolean;
  exit?: (code: number) => void;
}

const STALE_LOCK_MS = 30 * 60 * 1000;

export const PHASE_MODEL_DEFAULTS: Record<
  ActivePhase,
  { model: string; thinking: string }
> = {
  intake: { model: "claude-haiku-4-5", thinking: "off" },
  enrichment: { model: "claude-sonnet-4-6", thinking: "off" },
  spec: { model: "claude-sonnet-4-6", thinking: "high" },
  plan: { model: "claude-sonnet-4-6", thinking: "high" },
  implementation: { model: "claude-sonnet-4-6", thinking: "high" },
};

export function resolvePhaseModel(
  config: Config,
  phase: ActivePhase,
  ticket: TicketState,
): { model: string; thinking: string } {
  const ticketOverride = ticket.phases?.[phase];
  const configDefault = config.phases?.defaults?.[phase];
  const hardcoded = PHASE_MODEL_DEFAULTS[phase];
  return {
    model: ticketOverride?.model ?? configDefault?.model ?? hardcoded.model,
    thinking: ticketOverride?.thinking ?? configDefault?.thinking ??
      hardcoded.thinking,
  };
}

export interface TickDeps {
  spawn: (opts: {
    phase: ActivePhase;
    ticketDir: string;
    prompt: string;
    scope: string[];
    worktrees: Record<string, WorktreeInfo>;
    outputFile: string;
    model: string;
    thinking: string;
  }) => Promise<number>;
  isPidAlive: (pid: number) => boolean;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  writePhaseOutput: (
    stateDir: string,
    id: string,
    file: string,
    content: string,
  ) => Promise<void>;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
  resolveModelConfig: (
    phase: ActivePhase,
    ticket: TicketState,
  ) => { model: string; thinking: string };
  selfReview?: (phase: string, ticketDir: string) => Promise<boolean>;
}

export function selectCandidates(
  candidates: string[],
  lastWorked: string[],
  concurrency: number,
): string[] {
  if (candidates.length === 0) return [];

  let start = 0;
  for (let i = lastWorked.length - 1; i >= 0; i--) {
    const idx = candidates.indexOf(lastWorked[i]);
    if (idx !== -1) {
      start = (idx + 1) % candidates.length;
      break;
    }
  }

  const count = Math.min(concurrency, candidates.length);
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(candidates[(start + i) % candidates.length]);
  }
  return result;
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
    const outputFile = `${compactTimestamp(zonedNow)}-${activePhase}.md`;
    const isImplementationRevision = activePhase === "implementation";
    const prompt = isImplementationRevision
      ? await loadPromptFile("implementation-revision.md")
      : await loadPrompt(activePhase);
    const { model: revisingModel, thinking: revisingThinking } = deps
      .resolveModelConfig(activePhase, ticket);
    const pid = await deps.spawn({
      phase: activePhase,
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: ticket.scope,
      worktrees: isImplementationRevision ? ticket.worktrees : {},
      outputFile,
      model: revisingModel,
      thinking: revisingThinking,
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
    const { model: intakeModel, thinking: intakeThinking } = deps
      .resolveModelConfig("intake", ticket);
    const pid = await deps.spawn({
      phase: "intake",
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: [],
      worktrees: {},
      outputFile: `${compactTimestamp(zonedNow)}-intake.md`,
      model: intakeModel,
      thinking: intakeThinking,
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
      const waitingTicket: TicketState = {
        ...ticket,
        status: "waiting",
        pid: undefined,
        updated: now,
      };
      await deps.writeTicket(stateDir, waitingTicket);
      await deps.appendLog(stateDir, ticket.id, {
        event: "status-transition",
        phase: ticket.phase,
        from: "running",
        to: "waiting",
      });
      let approved = false;
      try {
        approved = deps.selfReview
          ? await deps.selfReview(ticket.phase, join(stateDir, ticket.id))
          : false;
      } catch {
        approved = false;
      }
      if (approved) {
        await deps.writeTicket(stateDir, { ...waitingTicket, approved: true });
        await deps.appendLog(stateDir, ticket.id, {
          event: "self-approved",
          phase: ticket.phase,
        });
      }
    }
    return;
  }

  if (
    ticket.phase === "implementation" &&
    ticket.status === "waiting" &&
    ticket.approved
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
      next === "implementation" &&
      Object.keys(ticket.worktrees).length === 0
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
    const { model: nextModel, thinking: nextThinking } = deps
      .resolveModelConfig(next, ticket);
    const pid = await deps.spawn({
      phase: next,
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: ticket.scope,
      worktrees: next === "implementation" ? ticket.worktrees : {},
      outputFile: `${compactTimestamp(zonedNow)}-${next}.md`,
      model: nextModel,
      thinking: nextThinking,
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

function defaultAdvanceTicketsDeps(): AdvanceTicketsDeps {
  const migrationsDir = new URL("../migrations", import.meta.url).pathname;
  const lastWorkedPath = join(
    Deno.env.get("HOME")!,
    ".lazyboy",
    "last-worked.json",
  );
  return {
    readLastWorked: async () => {
      try {
        const raw = await Deno.readTextFile(lastWorkedPath);
        const parsed = JSON.parse(raw);
        if (
          !Array.isArray(parsed) ||
          !parsed.every((x) => typeof x === "string")
        ) {
          return [];
        }
        return parsed as string[];
      } catch {
        return [];
      }
    },
    writeLastWorked: (ids) =>
      Deno.writeTextFile(lastWorkedPath, JSON.stringify(ids)),
    runMigrations: createMigrationRunner({
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
    }),
  };
}

export async function advanceTickets(
  config: Config,
  deps: AdvanceTicketsDeps = defaultAdvanceTicketsDeps(),
): Promise<void> {
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
  const ids = (await listTickets(stateDir)).sort();
  const tickets = await Promise.all(ids.map((id) => readTicket(stateDir, id)));

  const migratedTickets = await deps.runMigrations(stateDir, tickets);

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
    resolveConflictsAction({
      runGit,
      isPidAlive: defaultIsPidAlive,
      writeTicket,
      appendLog: appendTicketLog,
      stat: async (path) => {
        try {
          const info = await Deno.stat(path);
          return { isFile: info.isFile };
        } catch {
          return null;
        }
      },
      readDir: (path) => Deno.readDir(path),
      remove: (path) => Deno.remove(path),
    }),
    checkConflictsAction({
      runGit,
      isPidAlive: defaultIsPidAlive,
      worktreeExists: existsSync,
      writeTicket,
      appendLog: appendTicketLog,
      writeContextFile: async (ticketDir, branch, content) => {
        await Deno.writeTextFile(
          join(ticketDir, `conflict-context-${branch}.md`),
          content,
        );
      },
      spawn: (opts) => {
        const safeBranch = sanitizeBranchForFilename(opts.branch);
        const contextFilePaths = [
          `@${opts.ticketDir}/meta.md`,
          `@${opts.ticketDir}/conflict-context-${safeBranch}.md`,
        ];
        const prompt = `You are resolving git rebase conflicts. ` +
          `Examine the conflicted files listed in the context, resolve all merge conflicts, ` +
          `then run \`git rebase --continue\` until the rebase completes. ` +
          `After a successful rebase, run \`git push --force-with-lease origin ${opts.branch}\`.`;
        return Promise.resolve(
          spawnPhase({
            ticketDir: opts.ticketDir,
            prompt,
            scopeDirs: [],
            outputFile: "conflict-resolution.md",
            githubToken: token,
            anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
            worktrees: {
              [opts.branch]: { path: opts.worktreePath, branch: opts.branch },
            },
            model: "claude-opus-4-7",
            thinking: "high",
            contextFiles: contextFilePaths,
          }),
        );
      },
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

  const runningTickets = processedTickets.filter((t) => t.status === "running");
  const candidateTickets = processedTickets.filter(
    (t) =>
      t.status !== "done" &&
      t.status !== "needs-attention" &&
      !(t.phase === "merge" && t.status === "waiting") &&
      t.status !== "running",
  );

  const lastWorked = await deps.readLastWorked();
  const selectedIds = selectCandidates(
    candidateTickets.map((t) => t.id),
    lastWorked,
    maxRunning,
  );
  const selectedSet = new Set(selectedIds);

  const tickDepImpls: TickDeps = {
    spawn: (opts) =>
      Promise.resolve(
        spawnPhase({
          ticketDir: opts.ticketDir,
          prompt: opts.prompt,
          scopeDirs: opts.scope.map(expandHome),
          outputFile: opts.outputFile,
          githubToken: token,
          anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
          worktrees: opts.worktrees,
          model: opts.model,
          thinking: opts.thinking,
        }),
      ),
    isPidAlive: defaultIsPidAlive,
    writeTicket,
    writePhaseOutput,
    appendLog: appendTicketLog,
    resolveModelConfig: (phase, ticket) =>
      resolvePhaseModel(config, phase, ticket),
    selfReview: (phase, ticketDir) => selfReview(phase, ticketDir, fetch),
  };

  for (const ticket of runningTickets) {
    await advancePhase(ticket, stateDir, tickDepImpls);
  }

  let running = runningTickets.length;
  for (const ticket of candidateTickets) {
    if (!selectedSet.has(ticket.id)) continue;

    const willSpawn = ticket.status === "new" ||
      ticket.status === "revising" ||
      (ticket.status === "waiting" && ticket.approved);
    if (willSpawn && running >= maxRunning) continue;
    if (willSpawn) running++;

    await advancePhase(ticket, stateDir, tickDepImpls);
  }

  await deps.writeLastWorked(selectedIds);
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
    advanceTickets,
  };
}

export async function tick(deps?: TickOrchestrationDeps): Promise<void> {
  const d = deps ?? defaultTickDeps();
  const config = await d.loadConfig();
  const pidFile = join(Deno.env.get("HOME")!, ".lazyboy", "tick.pid");

  try {
    const existing = await Deno.readTextFile(pidFile).catch(() => null);
    if (existing) {
      const pid = parseInt(existing.trim(), 10);
      const alive = !isNaN(pid) && (d.isPidAlive ?? defaultIsPidAlive)(pid);
      if (alive) {
        const stat = await Deno.stat(pidFile).catch(() => null);
        const ageMs = stat?.mtime
          ? Temporal.Now.instant().epochMilliseconds - stat.mtime.getTime()
          : 0;
        if (ageMs < STALE_LOCK_MS) {
          console.log(`tick already running (pid ${pid}), exiting`);
          return;
        }
        console.warn(
          `tick lock held by pid ${pid} for over ${
            STALE_LOCK_MS / 60_000
          }m with no sign of finishing; assuming it is hung and reclaiming the lock`,
        );
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

  let tickError: unknown;
  try {
    await d.installPackages(config.packages.enabled);
    await d.advanceTickets(config);
  } catch (e) {
    tickError = e;
  } finally {
    await Deno.remove(pidFile).catch(() => {});
  }

  if (tickError) {
    const msg = tickError instanceof Error
      ? tickError.message
      : String(tickError);
    console.error(`tick failed: ${msg}`);
    (d.exit ?? Deno.exit)(1);
  }
}
