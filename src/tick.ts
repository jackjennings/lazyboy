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
  isApproved,
  type TicketState,
  type WorktreeInfo,
} from "./state/types.ts";
import { type ActivePhase, PHASE_SEQUENCE } from "./phases/types.ts";
import { mkdir, readDir, readTextFile, writeTextFile } from "./filesystem.ts";

const DEFAULT_MAX_PROMPT_TOKENS = 5_000;
const TICK_DEADLINE_MS = 4 * 60 * 60 * 1000;

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
  readPhaseSessionId: (
    ticketDir: string,
    phase: string,
  ) => Promise<string | null>;
  maxPromptTokens?: number;
  buildRepoCorpusText: () => Promise<string>;
  spawnOutlierAnalysis: (
    ticketId: string,
    ticketDir: string,
    lazboyWorktreePath: string,
    phase: "implementation" | "plan",
  ) => Promise<void>;
  adjudicatePhaseModel: (
    prompt: string,
  ) => Promise<{ model: string; thinking: string } | null>;
  readRunPidBootStamp: (ticketDir: string) => Promise<string | null>;
  currentBootId: () => string;
  checkToolAvailability: (
    partialNames: string[],
    effectivePath: string,
  ) => Promise<
    | { ok: true }
    | { ok: false; tool: string; missing: "binary" | "env-var"; name: string }
  >;
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
  exit(code: number): void;
  refreshAnthropicPricing(): Promise<void>;
  processLearnings(): Promise<void>;
  notify(ticket: TicketState): Promise<void>;
  appendTickLog(entry: object): Promise<void>;
  agentsMdPaths: string[];
  agentsMdMaxTokens?: number;
  runCeremonies(): Promise<void>;
  scaffoldStatePrompts(): Promise<void>;
  generateShortTitle(
    title: string,
    context?: string,
  ): Promise<string | null>;
  notifyTickFailure(error: string): Promise<void>;
  preflightGitHubCredentials(): Promise<void>;
  writeTickProgress: (label: string | null) => Promise<void>;
  deadlineMs?: number;
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
  const requiresPRs = ticket.artifacts.includes("code");
  const requiresWorktrees = ticket.artifacts.includes("code");
  const mergeStatus: "waiting" | "done" = requiresPRs ? "waiting" : "done";

  if (ticket.status === "revising") {
    const isMergeRevision = ticket.phase === "merge";
    const activePhase = isMergeRevision
      ? "implementation"
      : ticket.phase as ActivePhase;
    const outputFile = `${compactTimestamp(zonedNow)}-${
      isMergeRevision ? "merge" : activePhase
    }.md`;
    const isImplementationRevision = activePhase === "implementation";
    const { content: revisionContent } = await loadRevisionPrompt(activePhase);
    const basePrompt = revisionContent ||
      (await loadPrompt(activePhase)).content;
    const { content: revisingSupplement } = await loadProviderPrompt(
      activePhase,
      ticket.provider,
    );
    const { content: revisingArtifactSupplement } = await loadArtifactPrompt(
      activePhase,
      ticket.artifacts,
    );
    const { content: revisingStatePrompt } = await loadStatePrompt(
      activePhase,
      stateDir,
      ticket.provider,
      ticket.id,
    );
    const { content: revisingStateRevisionPrompt } = await loadStatePrompt(
      `${activePhase}-revision`,
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
      revisingStateRevisionPrompt,
      commentContext,
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
    const threshold = deps.maxPromptTokens ?? DEFAULT_MAX_PROMPT_TOKENS;
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
      resume: sessionId !== undefined,
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
    const { content: intakeBase } = await loadPrompt("intake");
    const { content: intakeSupplement } = await loadProviderPrompt(
      "intake",
      ticket.provider,
    );
    const { content: intakeArtifactSupplement } = await loadArtifactPrompt(
      "intake",
      ticket.artifacts,
    );
    const corpusText = await deps.buildRepoCorpusText();
    const { content: intakeStatePrompt } = await loadStatePrompt(
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
    const threshold = deps.maxPromptTokens ?? DEFAULT_MAX_PROMPT_TOKENS;
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
    const intakeUuid = crypto.randomUUID();
    await deps.writeTicket(stateDir, {
      ...ticket,
      phase: "intake",
      status: "running",
      updated: now,
      phaseSessionIds: { ...ticket.phaseSessionIds, intake: intakeUuid },
    });
    await deps.spawn({
      phase: "intake",
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: [],
      worktrees: {},
      outputFile: `${compactTimestamp(zonedNow)}-intake.md`,
      model: intakeModel,
      thinking: intakeThinking,
      sessionId: intakeUuid,
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
      const storedBootId = await deps.readRunPidBootStamp(
        join(stateDir, ticket.id),
      );
      await deleteRunPid(join(stateDir, ticket.id));
      const sessionIdFromSidecar = await deps.readPhaseSessionId(
        join(stateDir, ticket.id),
        ticket.phase,
      );
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
        const currentId = deps.currentBootId();
        if (
          storedBootId !== null &&
          storedBootId !== currentId &&
          waitingTicket.phaseSessionIds?.[ticket.phase]
        ) {
          const sessionId = waitingTicket.phaseSessionIds[ticket.phase]!;
          const outputFile = `${compactTimestamp(zonedNow)}-${ticket.phase}.md`;
          const resumePhase: ActivePhase = ticket.phase === "merge"
            ? "implementation"
            : ticket.phase as ActivePhase;
          const { model: resumeModel, thinking: resumeThinking } = deps
            .resolveModelConfig(resumePhase, ticket);
          await deps.spawn({
            phase: resumePhase,
            ticketDir: join(stateDir, ticket.id),
            prompt:
              `Your previous run was interrupted by a system restart. Continue from where you left off and write your output to ${outputFile}. Output nothing else.`,
            scope: ticket.scope,
            worktrees: resumePhase === "implementation" ? ticket.worktrees : {},
            outputFile,
            model: resumeModel,
            thinking: resumeThinking,
            sessionId,
            resume: true,
          });
          await deps.writeTicket(stateDir, {
            ...ticket,
            status: "running",
            outputRetries: undefined,
            updated: now,
          });
          await deps.appendLog(stateDir, ticket.id, {
            event: "phase-resumed",
            phase: ticket.phase,
          });
          return;
        }
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
        ticket.artifacts.includes("document") &&
        !(ticket.documents?.length)
      ) {
        await deps.writeTicket(stateDir, {
          ...waitingTicket,
          status: "needs-attention",
          updated: now,
        });
        await deps.appendLog(stateDir, ticket.id, {
          event: "needs-attention",
          reason: "no-pages",
        });
        return;
      }

      if (
        ticket.phase === "implementation" &&
        ticket.artifacts.includes("work") &&
        !(ticket.workItems?.length)
      ) {
        await deps.writeTicket(stateDir, {
          ...waitingTicket,
          status: "needs-attention",
          updated: now,
        });
        await deps.appendLog(stateDir, ticket.id, {
          event: "needs-attention",
          reason: "no-work-items",
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

      let feedbackPrecedesOutput = false;
      try {
        const outputPattern = new RegExp(
          `^\\d{8}T\\d{6}-${ticket.phase}\\.md$`,
        );
        const feedbackPattern = new RegExp(
          `^\\d{8}T\\d{6}-${ticket.phase}-feedback\\.md$`,
        );
        const relevantFiles: string[] = [];
        for await (const entry of readDir(join(stateDir, ticket.id))) {
          if (
            entry.isFile &&
            (outputPattern.test(entry.name) || feedbackPattern.test(entry.name))
          ) {
            relevantFiles.push(entry.name);
          }
        }
        relevantFiles.sort();
        const lastOutputIndex = relevantFiles.findLastIndex((name) =>
          outputPattern.test(name)
        );
        if (lastOutputIndex > 0) {
          feedbackPrecedesOutput = feedbackPattern.test(
            relevantFiles[lastOutputIndex - 1],
          );
        }
      } catch {
        // directory unreadable — proceed with normal self-review
      }
      const skipSelfReview = ticket.phase === "plan" &&
        (ticket.newRepos?.length ?? 0) > 0;
      if (!feedbackPrecedesOutput && !skipSelfReview) {
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
      }
      if (ticket.phase === "implementation") {
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
      if (ticket.phase === "plan") {
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
    if (requiresPRs) {
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
      status: mergeStatus,
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
      requiresWorktrees &&
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
    const { content: basePromptContent, partials: basePartials } =
      await loadPrompt(effectiveNext);
    const { content: supplement, partials: suppPartials } =
      await loadProviderPrompt(effectiveNext, ticket.provider);
    const { content: artifactSupplement, partials: artPartials } =
      await loadArtifactPrompt(
        effectiveNext,
        ticket.artifacts,
      );
    const { content: statePrompt, partials: statePartials } =
      await loadStatePrompt(
        effectiveNext,
        stateDir,
        ticket.provider,
        ticket.id,
      );
    const prompt = [
      basePromptContent,
      supplement,
      artifactSupplement,
      statePrompt,
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
    const threshold = deps.maxPromptTokens ?? DEFAULT_MAX_PROMPT_TOKENS;
    const tokens = estimateTokenCount(prompt);
    if (tokens > threshold) {
      await deps.appendLog(stateDir, ticket.id, {
        event: "prompt-too-long",
        phase: next,
        tokens,
        maxTokens: threshold,
      });
    }
    const allPartials = [
      ...new Set([
        ...basePartials,
        ...suppPartials,
        ...artPartials,
        ...statePartials,
      ]),
    ];
    const binDir = new URL("../bin", import.meta.url).pathname;
    const existingPath = Deno.env.get("PATH") ?? "";
    const effectivePath = existingPath ? `${binDir}:${existingPath}` : binDir;
    const preflightResult = await deps.checkToolAvailability(
      allPartials,
      effectivePath,
    );
    if (!preflightResult.ok) {
      await deps.writeTicket(stateDir, {
        ...ticket,
        phase: effectiveNext,
        status: "needs-attention",
        updated: now,
      });
      await deps.appendLog(stateDir, ticket.id, {
        event: "phase-transition",
        from: ticket.phase,
        to: "needs-attention",
        reason: "tool-unavailable",
        tool: preflightResult.tool,
        missing: preflightResult.missing,
        name: preflightResult.name,
      });
      return;
    }
    let resolvedTicket = ticket;
    if (next === "implementation") {
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
    const nextUuid = crypto.randomUUID();
    await deps.writeTicket(stateDir, {
      ...resolvedTicket,
      phase: effectiveNext,
      status: "running",
      updated: now,
      phaseSessionIds: {
        ...ticket.phaseSessionIds,
        [effectiveNext]: nextUuid,
      },
    });
    await deps.spawn({
      phase: effectiveNext,
      ticketDir: join(stateDir, ticket.id),
      prompt,
      scope: ticket.scope,
      worktrees: effectiveNext === "implementation" ? ticket.worktrees : {},
      outputFile: `${compactTimestamp(zonedNow)}-${effectiveNext}.md`,
      model: nextModel,
      thinking: nextThinking,
      sessionId: nextUuid,
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

class TickDeadlineError extends Error {}

export class TickService {
  #deps: TickServiceDeps;

  constructor(deps: TickServiceDeps) {
    this.#deps = deps;
  }

  async run(): Promise<void> {
    const deps = this.#deps;
    const deadlineMs = deps.deadlineMs ?? TICK_DEADLINE_MS;
    let deadlineTimerId: ReturnType<typeof setTimeout> | undefined;
    try {
      await deps.refreshAnthropicPricing();
      await deps.installPackages(deps.packageSources);
      try {
        await Promise.race([
          deps.lock.withLock(async () => {
            await deps.appendTickLog({
              event: "tick-start",
            });
            try {
              await this.#runWorkflow(deps);
            } catch (e) {
              await deps.appendTickLog({
                ts: Temporal.Now.instant().toString(),
                event: "tick-failed",
                error: e instanceof Error ? e.message : String(e),
              });
              throw e;
            }
            await deps.appendTickLog({
              event: "tick-end",
            });
          }),
          new Promise<never>((_, reject) => {
            deadlineTimerId = setTimeout(
              () => reject(new TickDeadlineError()),
              deadlineMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(deadlineTimerId);
      }
    } catch (e) {
      if (e instanceof TickDeadlineError) {
        await deps.appendTickLog({
          event: "tick-deadline-exceeded",
          deadlineMs,
        });
        try {
          await deps.notifyTickFailure("tick deadline exceeded");
        } catch {
          // notification failure must not suppress exit
        }
        deps.exit(1);
        return;
      }
      const errorStr = e instanceof Error ? e.message : String(e);
      console.error(e);
      try {
        await deps.notifyTickFailure(errorStr);
      } catch {
        // notification failure must not suppress original error or change exit code
      }
      deps.exit(1);
    }
  }

  async #runWorkflow(deps: TickServiceDeps): Promise<void> {
    await deps.preflightGitHubCredentials();
    await deps.processLearnings();
    const existingIds = new Set(await deps.listTickets());
    for (const provider of deps.providers) {
      const newItems = await provider.fetchNew(existingIds);
      for (const item of newItems) {
        const shortTitle =
          (await deps.generateShortTitle(item.title, item.description)) ??
            undefined;
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
          artifacts: ["code"],
        });
        await deps.tickDeps.appendLog(deps.stateDir, item.id, {
          event: "ticket-captured",
          title: item.title,
        });
      }
    }

    const ids = (await deps.listTickets()).sort();
    const settled = await Promise.allSettled(
      ids.map((id) => deps.readTicket(id)),
    );
    const validTickets: TicketState[] = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === "fulfilled") {
        validTickets.push(result.value);
      } else {
        const err = result.reason;
        await deps.appendTickLog({
          event: "ticket-read-error",
          id: ids[i],
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const migratedTickets = await deps.runMigrations(
      deps.stateDir,
      validTickets,
    );

    const processedTickets = [...migratedTickets];
    const totalNonWontDo = processedTickets.filter(
      (t) => t.phase !== "wont-do",
    ).length;
    let ticketIndex = 0;
    for (let i = 0; i < processedTickets.length; i++) {
      if (processedTickets[i].phase === "wont-do") continue;
      ticketIndex++;
      for (const action of deps.tickActions) {
        try {
          if (action.applies(processedTickets[i])) {
            if (action.label) {
              await deps.writeTickProgress(
                `${action.label} [${ticketIndex}/${totalNonWontDo}]`,
              );
            }
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
    await deps.writeTickProgress(null);

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
        await deps.notify(freshTicket);
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
        const agentsMdMaxTokens = deps.agentsMdMaxTokens ?? 0;
        if (deps.agentsMdPaths.length > 0 && agentsMdMaxTokens > 0) {
          for (const agentsMdPath of deps.agentsMdPaths) {
            let content: string;
            try {
              content = await readTextFile(agentsMdPath);
            } catch {
              continue;
            }
            const tokens = estimateTokenCount(content);
            if (tokens > agentsMdMaxTokens) {
              await deps.appendTickLog({
                event: "agents-md-too-large",
                path: agentsMdPath,
                tokens,
                maxTokens: agentsMdMaxTokens,
              });
            }
          }
        }
      }
      await advancePhase(ticket, deps.stateDir, deps.tickDeps);
    }

    await deps.writeLastWorked(selectedIds);
    await deps.scaffoldStatePrompts();
    await deps.commitState();
    await deps.runCeremonies();
  }
}

export { adjudicatePhaseModel };
