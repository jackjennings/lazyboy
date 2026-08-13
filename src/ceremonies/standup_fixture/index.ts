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

interface Ticket {
  provider: string;
  id: string;
  url: string;
  title: string;
  phase: string;
  status: string;
  updated: string;
}

function verbPhrase(ticket: Ticket, section: "Y" | "T"): string {
  if (ticket.phase === "merge" && ticket.status === "done") {
    return "Merged pull request for";
  }
  const p = VERB_PHRASES[ticket.phase];
  return section === "Y" ? (p?.past ?? "Worked on") : (p?.present ?? "Work on");
}

function renderStandup(
  now: Temporal.ZonedDateTime,
  tickets: Ticket[],
): string {
  const today = now.toPlainDate();
  const lastWorkday = now.dayOfWeek === 1
    ? today.subtract({ days: 3 })
    : today.subtract({ days: 1 });

  const d = today;
  const dateStr = `${d.year}-${String(d.month).padStart(2, "0")}-${
    String(d.day).padStart(2, "0")
  }`;

  const yTickets: Ticket[] = [];
  const tTickets: Ticket[] = [];

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

function extractUrls(text: string): string[] {
  const matches = [...text.matchAll(/\]\((https:\/\/[^)]+)\)/g)];
  return matches.map((m) => m[1]);
}

export default async function (context: {
  now: Temporal.ZonedDateTime;
  outputDir: string;
  listTickets(): Promise<string[]>;
  readTicket(id: string): Promise<Ticket>;
  generateText?: (request: {
    systemPrompt: string;
    prompt: string;
    maxTokens?: number;
  }) => Promise<string | null>;
  writeOutput(content: string): Promise<void>;
  commitState(): Promise<void>;
  notify(title: string, message: string): Promise<void>;
}): Promise<void> {
  const ids = await context.listTickets();
  const tickets = await Promise.all(ids.map((id) => context.readTicket(id)));
  const structured = renderStandup(context.now, tickets);

  let phrased = structured;

  if (context.generateText) {
    const priorFiles: string[] = [];
    try {
      for await (const entry of Deno.readDir(context.outputDir)) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          priorFiles.push(entry.name);
        }
      }
    } catch {
      // outputDir may not exist yet — treat as no prior files
    }
    priorFiles.sort();
    const recentFiles = priorFiles.slice(-3);

    const priorContents: string[] = [];
    for (const name of recentFiles) {
      try {
        priorContents.push(
          await Deno.readTextFile(`${context.outputDir}/${name}`),
        );
      } catch {
        // skip unreadable file
      }
    }

    const systemPrompt =
      `You are a standup message formatter. Rephrase the provided standup text ` +
      `to sound natural and human, like something a developer would actually type. ` +
      `Follow these rules exactly:\n` +
      `- Rephrase only — no invented facts, no invented progress, no dropped tickets\n` +
      `- Preserve the "# Standup — date" header, "Y:" and "T:" section labels, and bullet "*" formatting verbatim\n` +
      `- Preserve every Jira key and its full URL in markdown link format verbatim ` +
      `(e.g., [NW-1733](https://smarterdx.atlassian.net/browse/NW-1733))\n` +
      `- Vary phrasing from the prior standup outputs provided in context\n` +
      `- Return only the standup text — no commentary, preamble, or explanation`;

    const priorSection = priorContents.length > 0
      ? `\n\nRecent standups for phrasing reference:\n\n${
        priorContents.join("\n\n---\n\n")
      }`
      : "";

    const result = await context.generateText({
      systemPrompt,
      prompt: `Please rephrase this standup:\n\n${structured}${priorSection}`,
      maxTokens: 500,
    });

    if (result !== null) {
      const urls = extractUrls(structured);
      const allPresent = urls.every((url) => result.includes(url));
      if (allPresent) {
        phrased = result.trim();
      }
    }
  }

  await context.writeOutput(
    `${phrased.trimEnd()}\n\n## Structured\n\n${structured}`,
  );
  await context.commitState();
  await context.notify("lazyboy", "Standup ready");
}
