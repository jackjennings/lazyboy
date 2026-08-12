import { join } from "@std/path";
import type { TickAction } from "./types.ts";
import type { LearningState, TicketState } from "../state/types.ts";

export interface ResolveCITriageDeps {
  isProcessAlive: (ticketId: string) => boolean;
  hasCITriageContextFiles: (ticketId: string) => boolean;
  readDir: (path: string) => AsyncIterable<{ name: string; isFile: boolean }>;
  readFile: (path: string) => Promise<string | null>;
  remove: (path: string) => Promise<void>;
  createGitHubIssue: (opts: {
    repo: string;
    title: string;
    body: string;
  }) => Promise<void>;
  writeTicket: (stateDir: string, t: TicketState) => Promise<void>;
  appendLog: (stateDir: string, id: string, entry: object) => Promise<void>;
  writeLearning: (
    learning: Omit<LearningState, "id">,
    intent: string,
  ) => Promise<void>;
}

export function resolveCITriageAction(
  deps: ResolveCITriageDeps,
): TickAction {
  return {
    applies(ticket: TicketState): boolean {
      return (
        deps.hasCITriageContextFiles(ticket.id) &&
        !deps.isProcessAlive(ticket.id)
      );
    },

    async run(
      ticket: TicketState,
      stateDir: string,
    ): Promise<TicketState | null> {
      const ticketDir = join(stateDir, ticket.id);
      const now = Temporal.Now.instant().toString();

      const contextFiles: string[] = [];
      try {
        for await (const entry of deps.readDir(ticketDir)) {
          if (
            entry.isFile &&
            entry.name.includes("-ci-triage-context-") &&
            entry.name.endsWith(".md")
          ) {
            contextFiles.push(entry.name);
          }
        }
      } catch {
        // ticketDir not readable
      }

      if (contextFiles.length === 0) return null;

      let updated: TicketState = { ...ticket, updated: now };

      for (const contextFilename of contextFiles) {
        const contextPath = join(ticketDir, contextFilename);
        const contextContent = await deps.readFile(contextPath);
        if (contextContent === null) continue;

        const headers: Record<string, string> = {};
        for (const line of contextContent.split("\n")) {
          const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
          if (m) headers[m[1]] = m[2].trim();
        }
        const prUrl = headers["PR-URL"] ?? "";
        const repo = headers["Repo"] ?? "";
        const runId = headers["Run-ID"] ?? "";
        const branch = headers["Branch"] ?? "";

        const outputFilename = contextFilename.replace(
          "-ci-triage-context-",
          "-ci-triage-",
        );
        const outputPath = join(ticketDir, outputFilename);
        const outputContent = await deps.readFile(outputPath);

        if (outputContent === null) {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "resolveCITriage",
            reason: "output-file-missing",
            runId,
          });
          await deps.remove(contextPath);
          updated = { ...updated, status: "needs-attention", updated: now };
          await deps.writeTicket(stateDir, updated);
          return updated;
        }

        const verdictMatch = outputContent.match(
          /^VERDICT:\s*(PR_CAUSED|INFRA)/im,
        );
        if (!verdictMatch) {
          await deps.appendLog(stateDir, ticket.id, {
            event: "error",
            context: "resolveCITriage",
            reason: "no-verdict-line",
            runId,
          });
          await deps.remove(contextPath);
          updated = { ...updated, status: "needs-attention", updated: now };
          await deps.writeTicket(stateDir, updated);
          return updated;
        }

        const verdict = verdictMatch[1] as "PR_CAUSED" | "INFRA";
        const reasoning = outputContent
          .slice(0, outputContent.search(/^VERDICT:/im))
          .trim();

        if (verdict === "PR_CAUSED") {
          await deps.createGitHubIssue({
            repo,
            title: `Fix CI failure on ${branch || prUrl}`,
            body: `${reasoning}\n\nPR: ${prUrl}`,
          });
        }

        const learningMatch = outputContent.match(/^LEARNING:\s*(.+)$/im);
        const learningText = learningMatch?.[1]?.trim() ?? "";

        if (verdict === "PR_CAUSED" && learningText) {
          try {
            await deps.writeLearning(
              {
                ticketId: ticket.id,
                repo,
                targetFile: "AGENTS.md",
                prTitle: "ci: update AGENTS.md with implementation check",
                prBody:
                  `CI failure on branch ${branch}, PR ${prUrl}, run ${runId}`,
                status: "pending",
                prs: [],
              },
              learningText,
            );
          } catch (e) {
            console.error("writeLearning failed:", e);
          }
        }

        await deps.remove(contextPath);
        await deps.remove(outputPath);

        await deps.appendLog(stateDir, ticket.id, {
          event: "ci-triage-resolved",
          prUrl,
          runId,
          verdict,
        });
      }

      await deps.writeTicket(stateDir, updated);
      return updated;
    },
  };
}
