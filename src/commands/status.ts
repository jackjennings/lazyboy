import { join } from "@std/path";
import { bgGreen, bgRed, white } from "@std/fmt/colors";
import { listTickets, readTicket } from "../state/store.ts";
import { expandHome, loadConfig } from "../config.ts";
import { isCronEnabled } from "../cron.ts";
import { FULL_PHASE_SEQUENCE } from "../phases/types.ts";
import type { ApprovalEntry, PhaseUsage, TicketState } from "../state/types.ts";
import { STATUS_SEQUENCE } from "../state/types.ts";
import type { Command } from "./types.ts";
import { GitHubProvider } from "../providers/github.ts";
import { JiraProvider } from "../providers/jira.ts";
import { compareSortKeys } from "../providers/types.ts";

const toSortableMap: Record<string, (id: string) => Array<string | number>> = {
  github: GitHubProvider.toSortable,
  jira: JiraProvider.toSortable,
};

export function compareTickets(a: TicketState, b: TicketState): number {
  const aPhaseIdx = FULL_PHASE_SEQUENCE.indexOf(
    a.phase as typeof FULL_PHASE_SEQUENCE[number],
  );
  const bPhaseIdx = FULL_PHASE_SEQUENCE.indexOf(
    b.phase as typeof FULL_PHASE_SEQUENCE[number],
  );
  const ai = aPhaseIdx === -1 ? FULL_PHASE_SEQUENCE.length : aPhaseIdx;
  const bi = bPhaseIdx === -1 ? FULL_PHASE_SEQUENCE.length : bPhaseIdx;
  if (ai !== bi) return ai - bi;
  const aStatusIdx = STATUS_SEQUENCE.indexOf(
    a.status as typeof STATUS_SEQUENCE[number],
  );
  const bStatusIdx = STATUS_SEQUENCE.indexOf(
    b.status as typeof STATUS_SEQUENCE[number],
  );
  const asi = aStatusIdx === -1 ? STATUS_SEQUENCE.length : aStatusIdx;
  const bsi = bStatusIdx === -1 ? STATUS_SEQUENCE.length : bStatusIdx;
  if (asi !== bsi) return asi - bsi;
  if (a.provider !== b.provider) {
    return a.provider < b.provider ? -1 : 1;
  }
  const toSortableA = toSortableMap[a.provider] ?? ((id: string) => [id]);
  const toSortableB = toSortableMap[b.provider] ?? ((id: string) => [id]);
  return compareSortKeys(toSortableA(a.id), toSortableB(b.id));
}

export function formatTokens(total: number | null): string {
  if (total === null) return "—";
  if (total < 1000) return String(total);
  return `${(Math.round(total / 100) / 10).toFixed(1)}k`;
}

export async function readTicketTokens(
  ticketDir: string,
): Promise<number | null> {
  let total = 0;
  let found = false;
  try {
    for await (const entry of Deno.readDir(ticketDir)) {
      if (!entry.isFile || !entry.name.endsWith(".usage.json")) continue;
      try {
        const raw = await Deno.readTextFile(join(ticketDir, entry.name));
        const usage = JSON.parse(raw) as PhaseUsage;
        total += usage.input + usage.output + usage.cacheRead +
          usage.cacheWrite;
        found = true;
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
  return found ? total : null;
}

export function formatStatusRow(
  id: string,
  phase: string,
  status: string,
  approvals: ApprovalEntry[],
  tokenStr: string,
  title: string,
): string {
  const last = approvals.at(-1);
  const approvedFor = last?.phase === phase ? last.actor : null;
  const approvedStr = approvedFor ?? "-";
  return `${id.padEnd(36)} ${phase.padEnd(16)} ${status.padEnd(17)} ${
    approvedStr.padEnd(9)
  } ${tokenStr.padStart(10)} ${title}`;
}

export function shouldHideTicket(phase: string, status: string): boolean {
  return (phase === "merge" && status === "done") || phase === "wont-do";
}

export function formatStatusHeader(): string {
  return [
    `${"ID".padEnd(36)} ${"PHASE".padEnd(16)} ${"STATUS".padEnd(17)} ${
      "APPROVED".padEnd(9)
    } ${"TOKENS".padStart(10)} TITLE`,
    "-".repeat(117),
  ].join("\n");
}

export const status: Command = {
  name: "status",
  description: "show active tickets",
  async run(args) {
    const enabled = await isCronEnabled();
    const label = enabled
      ? bgGreen(white(" enabled "))
      : bgRed(white(" disabled "));
    console.log(label);
    console.log();

    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    const ids = await listTickets(stateDir);
    if (ids.length === 0) {
      console.log("No active tickets.");
      Deno.exit(0);
    }
    const tickets = await Promise.all(
      ids.map((id) => readTicket(stateDir, id)),
    );
    tickets.sort(compareTickets);
    const showAll = args.includes("--all");
    const visible = showAll
      ? tickets
      : tickets.filter((t) => !shouldHideTicket(t.phase, t.status));
    if (visible.length === 0) {
      console.log("No active tickets (run with --all to show completed).");
      Deno.exit(0);
    }
    const tokenTotals = await Promise.all(
      visible.map((t) => readTicketTokens(join(stateDir, t.id))),
    );
    console.log(formatStatusHeader());
    for (let i = 0; i < visible.length; i++) {
      const t = visible[i];
      console.log(
        formatStatusRow(
          t.id,
          t.phase,
          t.status,
          t.approvals,
          formatTokens(tokenTotals[i]),
          t.title,
        ),
      );
    }
  },
};
