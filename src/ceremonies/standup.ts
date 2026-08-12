import { join } from "@std/path";
import { compactTimestamp } from "../timestamp.ts";
import type { TicketState } from "../state/types.ts";
import type { Ceremony, StandupCeremonyDeps } from "./types.ts";
import { mkdir, writeTextFile } from "../filesystem.ts";

export type { StandupCeremonyDeps } from "./types.ts";

const VERB_PHRASES: Record<string, { past: string; present: string }> = {
  intake: { past: "Worked on intake for", present: "Work on intake for" },
  enrichment: {
    past: "Worked on enrichment for",
    present: "Work on enrichment for",
  },
  spec: {
    past: "Worked on specifications for",
    present: "Work on specifications for",
  },
  plan: { past: "Worked on plan for", present: "Work on plan for" },
  implementation: {
    past: "Worked on implementation for",
    present: "Work on implementation for",
  },
  merge: {
    past: "Worked on pull request for",
    present: "Prepare pull request for",
  },
};

function verbPhrase(ticket: TicketState, section: "Y" | "T"): string {
  if (ticket.phase === "merge" && ticket.status === "done") {
    return "Merged pull request for";
  }
  const p = VERB_PHRASES[ticket.phase];
  return section === "Y" ? (p?.past ?? "Worked on") : (p?.present ?? "Work on");
}

export class StandupCeremony implements Ceremony {
  readonly name = "standup";
  readonly #deps: StandupCeremonyDeps;

  constructor(deps: StandupCeremonyDeps) {
    this.#deps = deps;
  }

  async run(now: Temporal.ZonedDateTime, outputDir: string): Promise<void> {
    await mkdir(outputDir, { recursive: true });

    const ids = await this.#deps.listTickets();
    const tickets = await Promise.all(
      ids.map((id) => this.#deps.readTicket(id)),
    );

    const content = renderStandup(now, tickets);
    await writeTextFile(
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
  const today = now.toPlainDate();
  const lastWorkday = now.dayOfWeek === 1
    ? today.subtract({ days: 3 })
    : today.subtract({ days: 1 });

  const d = today;
  const dateStr = `${d.year}-${String(d.month).padStart(2, "0")}-${
    String(d.day).padStart(2, "0")
  }`;

  const yTickets: TicketState[] = [];
  const tTickets: TicketState[] = [];

  for (const t of tickets) {
    if (t.provider !== "jira") continue;
    const updatedDate = Temporal.Instant.from(t.updated)
      .toZonedDateTimeISO(now.timeZoneId)
      .toPlainDate();
    if (Temporal.PlainDate.compare(updatedDate, today) === 0) {
      tTickets.push(t);
    } else if (Temporal.PlainDate.compare(updatedDate, lastWorkday) === 0) {
      yTickets.push(t);
    }
  }

  const lines: string[] = [`# Standup — ${dateStr}`];

  if (yTickets.length === 0 && tTickets.length === 0) {
    lines.push(``, `No Jira tickets.`);
    return lines.join("\n") + "\n";
  }

  if (yTickets.length > 0) {
    lines.push(``, `Y:`);
    for (const t of yTickets) {
      const key = t.id.replace(/^jira\//, "");
      lines.push(`* ${verbPhrase(t, "Y")} ${t.title} ([${key}](${t.url}))`);
    }
  }

  if (tTickets.length > 0) {
    lines.push(``, `T:`);
    for (const t of tTickets) {
      const key = t.id.replace(/^jira\//, "");
      lines.push(`* ${verbPhrase(t, "T")} ${t.title} ([${key}](${t.url}))`);
    }
  }

  return lines.join("\n") + "\n";
}
