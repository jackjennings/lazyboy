import { join } from "@std/path";
import { deleteRunPid } from "./executor.ts";
import {
  loadPrompt,
  loadPromptFile,
  loadProviderPrompt,
  nextPhase,
} from "./phases/runners.ts";
import { compactTimestamp } from "./timestamp.ts";
import type { Lock } from "./lock.ts";
import type { Provider } from "./providers/types.ts";
import type { TickAction } from "./tick-actions/types.ts";
import type { MigrationFn } from "./migrations/runner.ts";
import type { InstallResult } from "./packages.ts";
import type { Config, TicketState, WorktreeInfo } from "./state/types.ts";
import type { ActivePhase } from "./phases/types.ts";

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
  }) => Promise<void>;
  isProcessAlive: (ticketId: string) => boolean;
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
  selfReview: (
    phase: string,
    ticketDir: string,
  ) => Promise<{ approved: boolean; reason: string | null }>;
  buildRepoCorpusText?: () => Promise<string>;
}

export interface TickServiceDeps {
  stateDir: string;
  concurrency: number;
  packageSources: string[];
  installPackages(sources: string[]): Promise<InstallResult[]>;
  providers: Provider[];
  tickActions: TickAction[];
  tickDeps: TickDeps;
  runMigrations: MigrationFn;
  readLastWorked(): Promise<string[]>;
  writeLastWorked(ids: string[]): Promise<void>;
  listTickets(): Promise<string[]>;
  readTicket(id: string): Promise<TicketState>;
  writeTicket(ticket: TicketState): Promise<void>;
  commitState(): Promise<void>;
  lock: Lock;
  exit?(code: number): void;
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
    const basePrompt = isImplementationRevision
      ? await loadPromptFile("implementation-revision.md")
      : await loadPrompt(activePhase);
    const revisingSupplement = await loadProviderPrompt(
      activePhase,
      ticket.provider,
    );
    const prompt = revisingSupplement
      ? basePrompt + "\n\n" + revisingSupplement
      : basePrompt;
    const { model: revisingModel, thinking: revisingThinking } = deps
      .resolveModelConfig(activePhase, ticket);
    await deps.spawn({
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
    const intakeBase = await loadPrompt("intake");
    const intakeSupplement = await loadProviderPrompt(
      "intake",
      ticket.provider,
    );
    const corpusText = (await deps.buildRepoCorpusText?.()) ?? "";
    const prompt = [intakeBase, intakeSupplement, corpusText]
      .filter((part) => part.length > 0)
      .join("\n\n");
    const { model: intakeModel, thinking: intakeThinking } = deps
      .resolveModelConfig("intake", ticket);
    await deps.spawn({
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
    if (!deps.isProcessAlive(ticket.id)) {
      await deleteRunPid(join(stateDir, ticket.id));
      const waitingTicket: TicketState = {
        ...ticket,
        status: "waiting",
        updated: now,
      };
      await deps.writeTicket(stateDir, waitingTicket);
      await deps.appendLog(stateDir, ticket.id, {
        event: "status-transition",
        phase: ticket.phase,
        from: "running",
        to: "waiting",
      });
      let selfReviewResult: { approved: boolean; reason: string | null } = {
        approved: false,
        reason: null,
      };
      try {
        selfReviewResult = await deps.selfReview(
          ticket.phase,
          join(stateDir, ticket.id),
        );
      } catch {
        // treated as { approved: false, reason: null }
      }
      if (selfReviewResult.approved) {
        await deps.writeTicket(stateDir, { ...waitingTicket, approved: true });
        await deps.appendLog(stateDir, ticket.id, {
          event: "self-approved",
          phase: ticket.phase,
        });
      } else if (selfReviewResult.reason !== null) {
        const filename = `${
          compactTimestamp(zonedNow)
        }-${ticket.phase}-self-review.md`;
        await deps.writePhaseOutput(
          stateDir,
          ticket.id,
          filename,
          selfReviewResult.reason,
        );
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
    const basePrompt = await loadPrompt(next);
    const supplement = await loadProviderPrompt(next, ticket.provider);
    const prompt = supplement ? basePrompt + "\n\n" + supplement : basePrompt;
    const { model: nextModel, thinking: nextThinking } = deps
      .resolveModelConfig(next, ticket);
    await deps.spawn({
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

export async function appendTickLog(entry: object): Promise<void> {
  const home = Deno.env.get("HOME")!;
  const tickLogPath = join(home, ".lazyboy", "tick.ndjson");
  await Deno.mkdir(join(home, ".lazyboy"), { recursive: true });
  await Deno.writeTextFile(
    tickLogPath,
    JSON.stringify({ ts: Temporal.Now.instant().toString(), ...entry }) + "\n",
    { append: true },
  );
}

export class TickService {
  #deps: TickServiceDeps;

  constructor(deps: TickServiceDeps) {
    this.#deps = deps;
  }

  async run(): Promise<void> {
    const deps = this.#deps;
    try {
      await deps.lock.withLock(async () => {
        try {
          await this.#runWorkflow(deps);
        } catch (e) {
          await appendTickLog({
            event: "tick-failed",
            error: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
      });
    } catch (e) {
      console.error(e);
      (deps.exit ?? Deno.exit)(1);
    }
  }

  async #runWorkflow(deps: TickServiceDeps): Promise<void> {
    await deps.installPackages(deps.packageSources);

    const existingIds = new Set(await deps.listTickets());
    for (const provider of deps.providers) {
      const newItems = await provider.fetchNew(existingIds);
      for (const item of newItems) {
        await deps.writeTicket({
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

    const ids = (await deps.listTickets()).sort();
    const tickets = await Promise.all(
      ids.map((id) => deps.readTicket(id)),
    );
    const migratedTickets = await deps.runMigrations(
      deps.stateDir,
      tickets,
    );

    const processedTickets = [...migratedTickets];
    for (let i = 0; i < processedTickets.length; i++) {
      for (const action of deps.tickActions) {
        if (action.applies(processedTickets[i])) {
          const updated = await action.run(
            processedTickets[i],
            deps.stateDir,
          );
          if (updated !== null) processedTickets[i] = updated;
        }
      }
    }

    const runningTickets = processedTickets.filter(
      (t) => t.status === "running",
    );
    const candidateTickets = processedTickets.filter(
      (t) =>
        t.status !== "done" &&
        t.status !== "needs-attention" &&
        !(t.phase === "merge" && t.status === "waiting") &&
        t.status !== "running" &&
        t.phase !== "wont-do",
    );

    const lastWorked = await deps.readLastWorked();
    const selectedIds = selectCandidates(
      candidateTickets.map((t) => t.id),
      lastWorked,
      deps.concurrency,
    );
    const selectedSet = new Set(selectedIds);

    for (const ticket of runningTickets) {
      await advancePhase(ticket, deps.stateDir, deps.tickDeps);
    }

    let running = runningTickets.length;
    for (const ticket of candidateTickets) {
      if (!selectedSet.has(ticket.id)) continue;
      const willSpawn = ticket.status === "new" ||
        ticket.status === "revising" ||
        (ticket.status === "waiting" && ticket.approved);
      if (willSpawn && running >= deps.concurrency) continue;
      if (willSpawn) running++;
      await advancePhase(ticket, deps.stateDir, deps.tickDeps);
    }

    await deps.writeLastWorked(selectedIds);
    await deps.commitState();
  }
}
