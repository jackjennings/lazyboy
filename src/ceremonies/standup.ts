import { join } from "@std/path";
import { parse } from "@std/toml";
import { compactTimestamp } from "../timestamp.ts";
import type { TicketState } from "../state/types.ts";
import type { Ceremony } from "./types.ts";

const PHASE_ORDER = [
  "intake",
  "enrichment",
  "spec",
  "plan",
  "implementation",
  "merge",
] as const;

export interface StandupCeremonyDeps {
  stateDir: string;
  listTickets(): Promise<string[]>;
  readTicket(id: string): Promise<TicketState>;
  commitState(): Promise<void>;
  appendTickLog(entry: object): Promise<void>;
  notify?: (title: string, message: string) => Promise<void>;
  now?: () => Temporal.ZonedDateTime;
}

export class StandupCeremony implements Ceremony {
  readonly name = "standup";
  readonly #deps: StandupCeremonyDeps;

  constructor(deps: StandupCeremonyDeps) {
    this.#deps = deps;
  }

  async run(): Promise<void> {
    const ceremonyDir = join(this.#deps.stateDir, "ceremonies", this.name);
    const configPath = join(ceremonyDir, "config.toml");
    let raw: string;
    try {
      raw = await Deno.readTextFile(configPath);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return;
      throw e;
    }

    let config: Record<string, unknown>;
    try {
      config = parse(raw) as Record<string, unknown>;
    } catch {
      await this.#deps.appendTickLog({
        event: "ceremony-warning",
        ceremony: "standup",
        reason: "could not parse config.toml",
      });
      return;
    }

    const timeStr = config.time;
    if (typeof timeStr !== "string" || !/^\d{2}:\d{2}$/.test(timeStr)) {
      await this.#deps.appendTickLog({
        event: "ceremony-warning",
        ceremony: "standup",
        reason: `invalid time: ${String(timeStr)}`,
      });
      return;
    }
    const hour = parseInt(timeStr.slice(0, 2), 10);
    const minute = parseInt(timeStr.slice(3), 10);
    if (hour > 23 || minute > 59) {
      await this.#deps.appendTickLog({
        event: "ceremony-warning",
        ceremony: "standup",
        reason: `invalid time: ${timeStr}`,
      });
      return;
    }

    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = (this.#deps.now ??
      (() => Temporal.Now.zonedDateTimeISO(localTz)))();
    const threshold = now.with({
      hour,
      minute,
      second: 0,
      millisecond: 0,
      microsecond: 0,
      nanosecond: 0,
    });

    if (Temporal.ZonedDateTime.compare(now, threshold) < 0) return;

    const todayPrefix = String(now.year) +
      String(now.month).padStart(2, "0") +
      String(now.day).padStart(2, "0");

    const outputDir = join(ceremonyDir, "output");
    try {
      for await (const entry of Deno.readDir(outputDir)) {
        if (entry.isFile && entry.name.startsWith(todayPrefix)) return;
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

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
