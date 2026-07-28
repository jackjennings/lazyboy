import { join } from "@std/path";
import { compactTimestamp } from "../timestamp.ts";
import type { TicketState } from "../state/types.ts";
import type { Ceremony, StandupCeremonyDeps } from "./types.ts";

export type { StandupCeremonyDeps } from "./types.ts";

const PHASE_ORDER = [
  "intake",
  "enrichment",
  "spec",
  "plan",
  "implementation",
  "merge",
] as const;

export class StandupCeremony implements Ceremony {
  readonly name = "standup";
  readonly #deps: StandupCeremonyDeps;

  constructor(deps: StandupCeremonyDeps) {
    this.#deps = deps;
  }

  async run(now: Temporal.ZonedDateTime, outputDir: string): Promise<void> {
    await Deno.mkdir(outputDir, { recursive: true });

    const ids = await this.#deps.listTickets();
    const tickets = await Promise.all(
      ids.map((id) => this.#deps.readTicket(id)),
    );
    const active = tickets.filter((t) => t.status !== "done");

    const content = renderStandup(now, active);
    await Deno.writeTextFile(
      join(outputDir, `${compactTimestamp(now)}-standup.md`),
      content,
    );

    await this.#deps.commitState();

    try {
      await this.#deps.notify?.("lazyboy", "Standup ready");
    } catch {
      // notification failures must not abort the ceremony run
    }
  }
}

export function renderStandup(
  now: Temporal.ZonedDateTime,
  tickets: TicketState[],
): string {
  const d = now.toPlainDate();
  const dateStr = `${d.year}-${String(d.month).padStart(2, "0")}-${
    String(d.day).padStart(2, "0")
  }`;

  const byPhase = new Map<string, TicketState[]>();
  for (const t of tickets) {
    if (!byPhase.has(t.phase)) byPhase.set(t.phase, []);
    byPhase.get(t.phase)!.push(t);
  }

  const lines: string[] = [`# Standup — ${dateStr}`];
  let hasAny = false;

  for (const phase of PHASE_ORDER) {
    const group = byPhase.get(phase);
    if (!group || group.length === 0) continue;
    hasAny = true;
    lines.push(``, `## ${phase}`);
    for (const t of group) {
      lines.push(`- [${t.id}] ${t.title} (${t.status})`);
    }
  }

  if (!hasAny) {
    lines.push(``, `No active tickets.`);
  }

  return lines.join("\n") + "\n";
}
