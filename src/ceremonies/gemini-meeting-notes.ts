import { join } from "@std/path";
import { compactTimestamp } from "../timestamp.ts";
import type { TicketState } from "../state/types.ts";
import type { Ceremony } from "./types.ts";

export interface GeminiMeetingNotesCeremonyDeps {
  stateDir: string;
  listTickets(): Promise<string[]>;
  readTicket(id: string): Promise<TicketState>;
  fetch: typeof globalThis.fetch;
  runClaude(prompt: string): Promise<string>;
  commitState(): Promise<void>;
  notify?: (title: string, message: string) => Promise<void>;
}

interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
}

export class GeminiMeetingNotesCeremony implements Ceremony {
  readonly name = "gemini-meeting-notes";
  readonly #deps: GeminiMeetingNotesCeremonyDeps;

  constructor(deps: GeminiMeetingNotesCeremonyDeps) {
    this.#deps = deps;
  }

  async run(now: Temporal.ZonedDateTime, outputDir: string): Promise<void> {
    const token = Deno.env.get("GOOGLE_ACCESS_TOKEN");
    if (!token) return;

    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.document' and name contains 'Meeting notes'",
      orderBy: "createdTime desc",
      pageSize: "20",
      fields: "files(id,name,createdTime)",
    });
    const listResponse = await this.#deps.fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (listResponse.status === 401) return;

    const listData = await listResponse.json();
    const allFiles: DriveFile[] = listData.files ?? [];

    const ceremonyDir = join(outputDir, "..");
    const seenPath = join(ceremonyDir, "seen.json");
    let seen: Set<string>;
    try {
      seen = new Set(JSON.parse(await Deno.readTextFile(seenPath)));
    } catch {
      seen = new Set();
    }

    const newFiles = allFiles.filter((f) => !seen.has(f.id));

    await Deno.mkdir(outputDir, { recursive: true });
    const d = now.toPlainDate();
    const dateStr = `${d.year}-${String(d.month).padStart(2, "0")}-${
      String(d.day).padStart(2, "0")
    }`;
    const outputPath = join(
      outputDir,
      `${compactTimestamp(now)}-gemini-meeting-notes.md`,
    );

    if (newFiles.length === 0) {
      await Deno.writeTextFile(
        outputPath,
        `# Gemini Meeting Notes Assessment — ${dateStr}\n\nNo new meeting summaries found.\n`,
      );
      await this.#deps.commitState();
      try {
        await this.#deps.notify?.("lazyboy", "Meeting notes assessment ready");
      } catch {
        // notification failures must not abort the ceremony run
      }
      return;
    }

    const fileContents: Array<{ file: DriveFile; content: string }> = [];
    for (const file of newFiles) {
      const exportResponse = await this.#deps.fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text%2Fplain`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      fileContents.push({ file, content: await exportResponse.text() });
    }

    const ids = await this.#deps.listTickets();
    const allTickets = await Promise.all(
      ids.map((id) => this.#deps.readTicket(id)),
    );
    const active = allTickets.filter((t) => t.status !== "done");

    const ticketLines = active
      .map((t) => `- [${t.id}] ${t.title} (${t.phase}/${t.status})`)
      .join("\n");
    const summaryLines = fileContents
      .map(
        ({ file, content }) =>
          `### ${file.name} (${file.createdTime})\n${content}`,
      )
      .join("\n\n");

    const prompt = [
      "You are an assistant that reviews meeting notes and identifies how they may affect active software development tickets. Be specific about ticket IDs when relevant.",
      "",
      "## Active Tickets",
      ticketLines,
      "",
      "## Meeting Summaries",
      summaryLines,
    ].join("\n");

    let assessment: string;
    try {
      assessment = await this.#deps.runClaude(prompt);
    } catch {
      assessment = "Error: assessment unavailable.";
    }

    await Deno.writeTextFile(
      outputPath,
      `# Gemini Meeting Notes Assessment — ${dateStr}\n\n${assessment}\n`,
    );

    await Deno.writeTextFile(
      seenPath,
      JSON.stringify([...seen, ...newFiles.map((f) => f.id)]) + "\n",
    );

    await this.#deps.commitState();
    try {
      await this.#deps.notify?.("lazyboy", "Meeting notes assessment ready");
    } catch {
      // notification failures must not abort the ceremony run
    }
  }
}
