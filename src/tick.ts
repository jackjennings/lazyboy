import { join } from "@std/path";
import { estimateTokenCount } from "tokenx";
import { lazyboyDir } from "./paths.ts";
import { adjudicatePhaseModel } from "./pre-phase-adjudication.ts";
import { deleteRunPid } from "./executor.ts";
import { extractPrinciples } from "./run-phase.ts";
import {
  loadArtifactPrompt,
  loadPrompt,
  loadProviderPrompt,
  loadRevisionPrompt,
  loadStatePrompt,
  nextPhase,
} from "./phases/runners.ts";
import { compactTimestamp } from "./timestamp.ts";
import type { Lock } from "./lock.ts";
import type { Provider } from "./providers/types.ts";
import type { TickAction } from "./tick-actions/types.ts";
import type { MigrationFn } from "./migrations/runner.ts";
import type { InstallResult } from "./packages.ts";
import {
  type ApprovalEntry,
  ARTIFACT_DESCRIPTORS,
  type Config,
  isApproved,
  type TicketState,
  type WorktreeInfo,
} from "./state/types.ts";
import { type ActivePhase, PHASE_SEQUENCE } from "./phases/types.ts";
import { mkdir, readDir, readTextFile, writeTextFile } from "./filesystem.ts";

export const PHASE_MODEL_DEFAULTS: Record<
  ActivePhase | "conflict-resolution" | "ci-fix",
  { model: string; thinking: string }
> = {
  intake: { model: "claude-haiku-4-5", thinking: "off" },
  enrichment: { model: "claude-sonnet-4-6", thinking: "off" },
  spec: { model: "claude-sonnet-4-6", thinking: "high" },
  plan: { model: "claude-sonnet-4-6", thinking: "high" },
  implementation: { model: "claude-sonnet-4-6", thinking: "high" },
  "conflict-resolution": { model: "claude-opus-4-7", thinking: "high" },
  "ci-fix": { model: "claude-sonnet-4-6", thinking: "high" },
};

export function resolvePhaseModel(
  config: Config,
  phase: ActivePhase | "conflict-resolution" | "ci-fix",
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
    sessionId?: string;
    resume?: boolean;
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
    worktreePath?: string,
  ) => Promise<{ approved: boolean; reason: string | null }>;
  markPRsReady: (prUrls: string[]) => Promise<void>;
  readPhaseOutput: (
    ticketDir: string,
    phase: string,
  ) => Promise<string | null>;
  appendPrinciples: (
    stateDir: string,
    ticketId: string,
    phase: string,
    outputContent: string,
  ) => Promise<void>;
  readPhaseExitCode: (
    ticketDir: string,
    phase: string,
  ) => Promise<number | null>;
  readPhaseSessionId?: (
    ticketDir: string,
    phase: string,
  ) => Promise<string | null>;
  maxPromptTokens?: number;
  buildRepoCorpusText?: () => Promise<string>;
  spawnOutlierAnalysis?: (
    ticketId: string,
    ticketDir: string,
    lazboyWorktreePath: string,
    phase: "implementation" | "plan",
  ) => Promise<void>;
  adjudicatePhaseModel?: (
    prompt: string,
  ) => Promise<{ model: string; thinking: string } | null>;
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
  refreshAnthropicPricing?(): Promise<void>;
  processLearnings?(): Promise<void>;
  notify?(ticket: TicketState): Promise<void>;
  appendTickLog?(entry: object): Promise<void>;
  agentsMdPaths?: string[];
  agentsMdMaxTokens?: number;
  runCeremonies?(): Promise<void>;
  scaffoldStatePrompts?(): Promise<void>;
  generateShortTitle?(
    title: string,
    context?: string,
  ): Promise<string | null>;
  notifyTickFailure?(error: string): Promise<void>;
  preflightGitHubCredentials?(): Promise<void>;
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
  const descriptor = ARTIFACT_DESCRIPTORS[ticket.artifact];

  if (ticket.status === "revising") {
    const isMergeRevision = ticket.phase === "merge";
    const activePhase = isMergeRevision
      ? "implementation"
      : ticket.phase as ActivePhase;
    const outputFile = `${compactTimestamp(zonedNow)}-${
      isMergeRevision ? "merge" : activePhase
    }.md`;
    const isImplementationRevision = activePhase === "implementation";
    const revisionPrompt = await loadRevisionPrompt(activePhase);
    const basePrompt = revisionPrompt || await loadPrompt(activePhase);
    const revisingSupplement = await loadProviderPrompt(
      activePhase,
      ticket.provider,
    );
    const revisingArtifactSupplement = await loadArtifactPrompt(
      activePhase,
      ticket.artifact,
    );
    const revisingStatePrompt = await loadStatePrompt(
      activePhase,
      stateDir,
      ticket.provider,
      ticket.id,
    );
    let commentContext = "";
    try {
      const contextFiles: string[] = [];
      for await (const entry of readDir(join(stateDir, ticket.id))) {
        if (entry.isFile && entry.name.endsWith("-comment-context.md")) {
          contextFiles.push(entry.name);
        }
      }
      contextFiles.sort();
      const last = contextFiles.at(-1);
      if (last) {
        commentContext = await readTextFile(join(stateDir, ticket.id, last));
      }
    } catch {
      // directory missing or unreadable — proceed without comment context
    }
    const prompt = [
      basePrompt,
      revisingSupplement,
      revisingArtifactSupplement,
      revisingStatePrompt,
      commentContext,
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
    const threshold = deps.maxPromptTokens ?? 5_000;
    const tokens = estimateTokenCount(prompt);
    if (tokens > threshold) {
      await deps.appendLog(stateDir, ticket.id, {
        event: "prompt-too-long",
        phase: activePhase,
        tokens,
        maxTokens: threshold,
      });
    }
    const { model: revisingModel, thinking: revisingThinking } = deps
      .resolveModelConfig(activePhase, ticket);
    let sessionId: string | undefined;
    if (isImplementationRevision) {
      const stored = ticket.phaseSessionIds?.["implementation"];
      if (stored) sessionId = stored;
    }
    await deps.spawn({
      phase: activePhase,
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: ticket.scope,
      worktrees: isImplementationRevision ? ticket.worktrees : {},
      outputFile,
      model: revisingModel,
      thinking: revisingThinking,
      sessionId,
    });
    await deps.writeTicket(stateDir, {
      ...ticket,
      status: "running",
      updated: now,
      notifiedNeedsAttention: false,
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
    const intakeArtifactSupplement = await loadArtifactPrompt(
      "intake",
      ticket.artifact,
    );
    const corpusText = (await deps.buildRepoCorpusText?.()) ?? "";
    const intakeStatePrompt = await loadStatePrompt(
      "intake",
      stateDir,
      ticket.provider,
      ticket.id,
    );
    const prompt = [
      intakeBase,
      intakeSupplement,
      intakeArtifactSupplement,
      corpusText,
      intakeStatePrompt,
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
    const threshold = deps.maxPromptTokens ?? 5_000;
    const tokens = estimateTokenCount(prompt);
    if (tokens > threshold) {
      await deps.appendLog(stateDir, ticket.id, {
        event: "prompt-too-long",
        phase: "intake",
        tokens,
        maxTokens: threshold,
      });
    }
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
      const sessionIdFromSidecar = deps.readPhaseSessionId
        ? await deps.readPhaseSessionId(join(stateDir, ticket.id), ticket.phase)
        : null;
      const phaseSessionIds = sessionIdFromSidecar !== null
        ? { ...ticket.phaseSessionIds, [ticket.phase]: sessionIdFromSidecar }
        : ticket.phaseSessionIds;
      const waitingTicket: TicketState = {
        ...ticket,
        outputRetries: undefined,
        status: "waiting",
        updated: now,
        phaseSessionIds,
      };
      await deps.writeTicket(stateDir, waitingTicket);
      await deps.appendLog(stateDir, ticket.id, {
        event: "status-transition",
        phase: ticket.phase,
        from: "running",
        to: "waiting",
      });

      const exitCode = await deps.readPhaseExitCode(
        join(stateDir, ticket.id),
        ticket.phase,
      );
      if (exitCode === null) {
        await deps.writeTicket(stateDir, {
          ...waitingTicket,
          status: "needs-attention",
          updated: now,
        });
        await deps.appendLog(stateDir, ticket.id, {
          event: "phase-output-invalid",
          phase: ticket.phase,
          reason: "incomplete",
        });
        return;
      }
      if (exitCode !== 0) {
        await deps.writeTicket(stateDir, {
          ...waitingTicket,
          status: "needs-attention",
          updated: now,
        });
        await deps.appendLog(stateDir, ticket.id, {
          event: "phase-output-invalid",
          phase: ticket.phase,
          reason: "non-zero-exit",
        });
        return;
      }

      const outputContent = await deps.readPhaseOutput(
        join(stateDir, ticket.id),
        ticket.phase,
      );
      if (outputContent === null) {
        const retries = ticket.outputRetries ?? 0;
        if (retries < 1) {
          const sessionId = waitingTicket.phaseSessionIds?.[ticket.phase];
          if (sessionId) {
            const outputFile = `${
              compactTimestamp(zonedNow)
            }-${ticket.phase}.md`;
            const retryPhase: ActivePhase = ticket.phase === "merge"
              ? "implementation"
              : ticket.phase as ActivePhase;
            const { model: retryModel, thinking: retryThinking } = deps
              .resolveModelConfig(retryPhase, ticket);
            await deps.spawn({
              phase: retryPhase,
              ticketDir: join(stateDir, ticket.id),
              prompt:
                `You did not create the output file. Use the Write tool to write your previous response to ${outputFile} now. Output nothing else.`,
              scope: [],
              worktrees: retryPhase === "implementation"
                ? ticket.worktrees
                : {},
              outputFile,
              model: retryModel,
              thinking: retryThinking,
              sessionId,
              resume: true,
            });
            await deps.writeTicket(stateDir, {
              ...ticket,
              outputRetries: 1,
              status: "running",
              updated: now,
            });
            await deps.appendLog(stateDir, ticket.id, {
              event: "phase-output-retry",
              phase: ticket.phase,
              attempt: 1,
            });
            return;
          }
        }
        await deps.writeTicket(stateDir, {
          ...waitingTicket,
          status: "needs-attention",
          updated: now,
        });
        await deps.appendLog(stateDir, ticket.id, {
          event: "phase-output-invalid",
          phase: ticket.phase,
          reason: "missing",
        });
        return;
      }
      if (outputContent.trim() === "") {
        await deps.writeTicket(stateDir, {
          ...waitingTicket,
          status: "needs-attention",
          updated: now,
        });
        await deps.appendLog(stateDir, ticket.id, {
          event: "phase-output-invalid",
          phase: ticket.phase,
          reason: "empty",
        });
        return;
      }

      if (
        ticket.phase === "implementation" &&
        !descriptor.requiresPRs &&
        !(ticket[descriptor.completionField]?.length)
      ) {
        await deps.writeTicket(stateDir, {
          ...waitingTicket,
          status: "needs-attention",
          updated: now,
        });
        await deps.appendLog(stateDir, ticket.id, {
          event: "phase-transition",
          from: "implementation",
          to: "needs-attention",
          reason: descriptor.missingReason,
        });
        return;
      }

      const principles = extractPrinciples(outputContent);
      if (principles) {
        await deps.appendPrinciples(
          stateDir,
          ticket.id,
          ticket.phase,
          outputContent,
        );
      }

      let selfReviewResult: { approved: boolean; reason: string | null } = {
        approved: false,
        reason: null,
      };
      try {
        selfReviewResult = await deps.selfReview(
          ticket.phase,
          join(stateDir, ticket.id),
          ticket.worktrees["jackjennings/lazyboy"]?.path,
        );
      } catch {
        // treated as { approved: false, reason: null }
      }
      if (selfReviewResult.approved) {
        const agentEntry: ApprovalEntry = {
          timestamp: Temporal.Now.instant().toString(),
          actor: "agent",
          phase: ticket.phase,
        };
        await deps.writeTicket(stateDir, {
          ...waitingTicket,
          approvals: [...waitingTicket.approvals, agentEntry],
        });
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
      if (ticket.phase === "implementation" && deps.spawnOutlierAnalysis) {
        const wt = ticket.worktrees["jackjennings/lazyboy"];
        if (wt) {
          deps.spawnOutlierAnalysis(
            ticket.id,
            join(stateDir, ticket.id),
            wt.path,
            "implementation",
          ).catch(() => {});
        } else {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "spawnOutlierAnalysis",
            message: "no jackjennings/lazyboy worktree",
          });
        }
      }
      if (ticket.phase === "plan" && deps.spawnOutlierAnalysis) {
        const wt = ticket.worktrees["jackjennings/lazyboy"];
        if (wt) {
          deps.spawnOutlierAnalysis(
            ticket.id,
            join(stateDir, ticket.id),
            wt.path,
            "plan",
          ).catch(() => {});
        } else {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "spawnOutlierAnalysis",
            message: "no jackjennings/lazyboy worktree",
          });
        }
      }
    }
    return;
  }

  if (
    ticket.phase === "implementation" &&
    ticket.status === "waiting" &&
    isApproved(ticket)
  ) {
    if (descriptor.requiresPRs) {
      const unmergedUrls = (ticket.prs ?? [])
        .filter((pr) => !pr.merged)
        .map((pr) => pr.url);
      if (unmergedUrls.length > 0) {
        try {
          await deps.markPRsReady(unmergedUrls);
        } catch (e) {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "markPRsReady",
            message: String(e),
          });
        }
      }
    }
    await deps.writeTicket(stateDir, {
      ...ticket,
      phase: "merge",
      status: descriptor.mergeStatus,
      updated: now,
    });
    await deps.appendLog(stateDir, ticket.id, {
      event: "phase-transition",
      from: ticket.phase,
      to: "merge",
    });
    return;
  }

  const activePhases = PHASE_SEQUENCE.filter((p) => p !== "implementation");
  if (
    ticket.status === "waiting" &&
    isApproved(ticket) &&
    (activePhases as string[]).includes(ticket.phase)
  ) {
    const activePhase = ticket.phase as ActivePhase;
    const next = nextPhase(activePhase);
    if (next === "done") return;
    const effectiveNext: ActivePhase = activePhase === "spec" &&
        ticket.phases?.plan?.skip === true &&
        next === "plan"
      ? nextPhase("plan") as ActivePhase
      : next;
    if (
      effectiveNext === "implementation" &&
      descriptor.requiresWorktrees &&
      Object.keys(ticket.worktrees).length === 0
    ) {
      await deps.writeTicket(stateDir, {
        ...ticket,
        phase: "implementation",
        status: "needs-attention",
        updated: now,
      });
      await deps.appendLog(stateDir, ticket.id, {
        event: "phase-transition",
        from: ticket.phase,
        to: "needs-attention",
        reason: "no-worktrees",
      });
      return;
    }
    const basePrompt = await loadPrompt(effectiveNext);
    const supplement = await loadProviderPrompt(effectiveNext, ticket.provider);
    const artifactSupplement = await loadArtifactPrompt(
      effectiveNext,
      ticket.artifact,
    );
    const statePrompt = await loadStatePrompt(
      effectiveNext,
      stateDir,
      ticket.provider,
      ticket.id,
    );
    const prompt = [basePrompt, supplement, artifactSupplement, statePrompt]
      .filter((part) => part.length > 0)
      .join("\n\n");
    const threshold = deps.maxPromptTokens ?? 5_000;
    const tokens = estimateTokenCount(prompt);
    if (tokens > threshold) {
      await deps.appendLog(stateDir, ticket.id, {
        event: "prompt-too-long",
        phase: next,
        tokens,
        maxTokens: threshold,
      });
    }
    let resolvedTicket = ticket;
    if (next === "implementation" && deps.adjudicatePhaseModel) {
      try {
        const override = await deps.adjudicatePhaseModel(prompt);
        if (override !== null) {
          resolvedTicket = {
            ...ticket,
            phases: { ...ticket.phases, implementation: override },
          };
          await deps.writeTicket(stateDir, resolvedTicket);
        }
      } catch {
        // silently skip — resolveModelConfig proceeds with original ticket state
      }
    }
    const { model: nextModel, thinking: nextThinking } = deps
      .resolveModelConfig(effectiveNext, resolvedTicket);
    await deps.spawn({
      phase: effectiveNext,
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: ticket.scope,
      worktrees: effectiveNext === "implementation" ? ticket.worktrees : {},
      outputFile: `${compactTimestamp(zonedNow)}-${effectiveNext}.md`,
      model: nextModel,
      thinking: nextThinking,
    });
    await deps.writeTicket(stateDir, {
      ...resolvedTicket,
      phase: effectiveNext,
      status: "running",
      updated: now,
    });
    await deps.appendLog(stateDir, ticket.id, {
      event: "phase-transition",
      from: ticket.phase,
      to: effectiveNext,
    });
    return;
  }
}

export async function appendTickLog(entry: object): Promise<void> {
  const lazyDir = lazyboyDir();
  const ts = Temporal.Now.instant().toString();
  await mkdir(lazyDir, { recursive: true });
  await writeTextFile(
    join(lazyDir, "tick.ndjson"),
    JSON.stringify({ ts, ...entry }) + "\n",
    { append: true },
  );
  try {
    await writeTextFile(
      join(lazyDir, "log.ndjson"),
      JSON.stringify({ ts, ...entry }) + "\n",
      { append: true },
    );
  } catch {
    // combined log failure must not interrupt tick log writes
  }
}

export class TickService {
  #deps: TickServiceDeps;

  constructor(deps: TickServiceDeps) {
    this.#deps = deps;
  }

  async run(): Promise<void> {
    const deps = this.#deps;
    try {
      await deps.refreshAnthropicPricing?.();
      await deps.installPackages(deps.packageSources);
      await deps.lock.withLock(async () => {
        try {
          await this.#runWorkflow(deps);
        } catch (e) {
          await (deps.appendTickLog ?? appendTickLog)({
            ts: Temporal.Now.instant().toString(),
            event: "tick-failed",
            error: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
      });
    } catch (e) {
      const errorStr = e instanceof Error ? e.message : String(e);
      console.error(e);
      try {
        await deps.notifyTickFailure?.(errorStr);
      } catch {
        // notification failure must not suppress original error or change exit code
      }
      (deps.exit ?? Deno.exit)(1);
    }
  }

  async #runWorkflow(deps: TickServiceDeps): Promise<void> {
    await deps.preflightGitHubCredentials?.();
    await deps.processLearnings?.();
    const existingIds = new Set(await deps.listTickets());
    for (const provider of deps.providers) {
      const newItems = await provider.fetchNew(existingIds);
      for (const item of newItems) {
        const shortTitle = deps.generateShortTitle
          ? (await deps.generateShortTitle(item.title, item.description)) ??
            undefined
          : undefined;
        await deps.writeTicket({
          id: item.id,
          provider: item.provider,
          title: item.title,
          shortTitle,
          url: item.url,
          phase: "intake",
          status: "new",
          approvals: [],
          scope: [],
          worktrees: {},
          created: Temporal.Now.instant().toString(),
          updated: Temporal.Now.instant().toString(),
          body: item.description,
          artifact: "pr",
        });
        await deps.tickDeps.appendLog(deps.stateDir, item.id, {
          event: "ticket-captured",
          title: item.title,
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
      if (processedTickets[i].phase === "wont-do") continue;
      for (const action of deps.tickActions) {
        try {
          if (action.applies(processedTickets[i])) {
            const updated = await action.run(
              processedTickets[i],
              deps.stateDir,
            );
            if (updated !== null) processedTickets[i] = updated;
          }
        } catch (e) {
          await deps.tickDeps.appendLog(
            deps.stateDir,
            processedTickets[i].id,
            {
              event: "error",
              context: "tickAction",
              action:
                (action as { constructor?: { name?: string } }).constructor
                  ?.name ?? "unknown",
              message: String(e),
            },
          );
        }
      }
    }

    for (let i = 0; i < processedTickets.length; i++) {
      const ticket = processedTickets[i];
      if (
        ticket.status === "needs-attention" && !ticket.notifiedNeedsAttention
      ) {
        const freshTicket = await deps.readTicket(ticket.id);
        if (
          freshTicket.status !== "needs-attention" ||
          freshTicket.notifiedNeedsAttention
        ) {
          continue;
        }
        await deps.notify?.(freshTicket);
        const updated = { ...freshTicket, notifiedNeedsAttention: true };
        await deps.writeTicket(updated);
        processedTickets[i] = updated;
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

    let running =
      runningTickets.filter((t) => deps.tickDeps.isProcessAlive(t.id)).length;
    for (const ticket of candidateTickets) {
      if (!selectedSet.has(ticket.id)) continue;
      const willSpawn = ticket.status === "new" ||
        ticket.status === "revising" ||
        (ticket.status === "waiting" && isApproved(ticket));
      if (willSpawn && running >= deps.concurrency) continue;
      if (willSpawn) {
        running++;
        if (
          deps.agentsMdPaths &&
          deps.agentsMdPaths.length > 0 &&
          deps.agentsMdMaxTokens &&
          deps.agentsMdMaxTokens > 0
        ) {
          for (const agentsMdPath of deps.agentsMdPaths) {
            let content: string;
            try {
              content = await readTextFile(agentsMdPath);
            } catch {
              continue;
            }
            const tokens = estimateTokenCount(content);
            if (tokens > deps.agentsMdMaxTokens) {
              await (deps.appendTickLog ?? appendTickLog)({
                event: "agents-md-too-large",
                path: agentsMdPath,
                tokens,
                maxTokens: deps.agentsMdMaxTokens,
              });
            }
          }
        }
      }
      await advancePhase(ticket, deps.stateDir, deps.tickDeps);
    }

    await deps.writeLastWorked(selectedIds);
    await deps.scaffoldStatePrompts?.();
    await deps.commitState();
    await deps.runCeremonies?.();
  }
}

export { adjudicatePhaseModel };
