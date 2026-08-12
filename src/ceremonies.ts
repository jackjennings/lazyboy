import { join } from "@std/path";
import { parse } from "@std/toml";
import { exists, readDir, readTextFile } from "./filesystem.ts";
import type { Ceremony } from "./ceremonies/types.ts";
import { PromptCeremony } from "./ceremonies/prompt.ts";
import { ModuleCeremony } from "./ceremonies/module.ts";
import {
  isCeremonyApproved,
  readApprovals,
  writeApprovals,
} from "./ceremonies/approvals.ts";
import { compactTimestamp } from "./timestamp.ts";
import type { TicketState } from "./state/types.ts";
import type { LanguageModelRequest } from "./models/types.ts";

export type { Ceremony } from "./ceremonies/types.ts";

export interface CeremonyRunnerDeps {
  stateDir: string;
  appendTickLog(entry: object): Promise<void>;
  now?: () => Temporal.ZonedDateTime;
  runClaude?: (args: string[]) => Promise<{ stdout: string; code: number }>;
  notify?(title: string, message: string): Promise<void>;
  listTickets(): Promise<string[]>;
  readTicket(id: string): Promise<TicketState>;
  generateText(request: LanguageModelRequest): Promise<string | null>;
  commitState(): Promise<void>;
}

function parseTimestampPrefix(filename: string): Temporal.PlainDateTime | null {
  if (filename.length < 15 || filename[8] !== "T") return null;
  const year = parseInt(filename.slice(0, 4), 10);
  const month = parseInt(filename.slice(4, 6), 10);
  const day = parseInt(filename.slice(6, 8), 10);
  const hour = parseInt(filename.slice(9, 11), 10);
  const minute = parseInt(filename.slice(11, 13), 10);
  const second = parseInt(filename.slice(13, 15), 10);
  if (
    isNaN(year) || isNaN(month) || isNaN(day) ||
    isNaN(hour) || isNaN(minute) || isNaN(second)
  ) return null;
  try {
    return Temporal.PlainDateTime.from({
      year,
      month,
      day,
      hour,
      minute,
      second,
    });
  } catch {
    return null;
  }
}

export class CeremonyRunner {
  readonly #deps: CeremonyRunnerDeps;
  readonly #ceremonies: Map<string, Ceremony>;

  constructor(deps: CeremonyRunnerDeps, ceremonies: Ceremony[]) {
    this.#deps = deps;
    this.#ceremonies = new Map(ceremonies.map((c) => [c.name, c]));
  }

  async run(): Promise<void> {
    const ceremoniesDir = join(this.#deps.stateDir, "ceremonies");
    const dirEntries: Deno.DirEntry[] = [];
    try {
      for await (const entry of readDir(ceremoniesDir)) {
        dirEntries.push(entry);
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return;
      throw e;
    }
    for (const entry of dirEntries) {
      if (!entry.isDirectory) continue;
      const ceremonyDir = join(ceremoniesDir, entry.name);
      const builtin = this.#ceremonies.get(entry.name);
      if (builtin) {
        await this.#runCeremony(builtin, ceremonyDir, false);
        continue;
      }
      if (await exists(join(ceremonyDir, "index.ts"))) {
        await this.#runCeremony(
          new ModuleCeremony({
            name: entry.name,
            stateDir: this.#deps.stateDir,
            ceremonyDir,
            appendTickLog: this.#deps.appendTickLog,
            listTickets: this.#deps.listTickets,
            readTicket: this.#deps.readTicket,
            generateText: this.#deps.generateText,
            commitState: this.#deps.commitState,
            notify: this.#deps.notify,
          }),
          ceremonyDir,
          true,
        );
        continue;
      }
      if (!await exists(join(ceremonyDir, "prompt.md"))) continue;
      await this.#runCeremony(
        new PromptCeremony({
          name: entry.name,
          stateDir: this.#deps.stateDir,
          appendTickLog: this.#deps.appendTickLog,
          runClaude: this.#deps.runClaude,
        }),
        ceremonyDir,
        true,
      );
    }
  }

  async #runCeremony(
    ceremony: Ceremony,
    ceremonyDir: string,
    gated: boolean,
  ): Promise<void> {
    const configPath = join(ceremonyDir, "config.toml");
    let raw: string;
    try {
      raw = await readTextFile(configPath);
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
        ceremony: ceremony.name,
        reason: "could not parse config.toml",
      });
      return;
    }

    const timeStr = config.time;
    if (typeof timeStr !== "string" || !/^\d{2}:\d{2}$/.test(timeStr)) {
      await this.#deps.appendTickLog({
        event: "ceremony-warning",
        ceremony: ceremony.name,
        reason: `invalid time: ${String(timeStr)}`,
      });
      return;
    }
    const hour = parseInt(timeStr.slice(0, 2), 10);
    const minute = parseInt(timeStr.slice(3), 10);
    if (hour > 23 || minute > 59) {
      await this.#deps.appendTickLog({
        event: "ceremony-warning",
        ceremony: ceremony.name,
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

    const outputDir = join(ceremonyDir, "output");
    const window = await this.#dueWindow({
      config,
      now,
      threshold,
      outputDir,
      name: ceremony.name,
    });
    if (window === null) return;

    if (gated && !await isCeremonyApproved(ceremony.name, ceremonyDir)) {
      const approvals = await readApprovals();
      const entry = approvals[ceremony.name];
      if (entry?.lastWarnedWindow === window) return;
      await this.#deps.appendTickLog({
        event: "ceremony-warning",
        ceremony: ceremony.name,
        reason: "not-approved",
      });
      try {
        await this.#deps.notify?.(
          "lazyboy",
          `Ceremony ${ceremony.name} needs approval`,
        );
      } catch {
        // notification failures must not abort the run
      }
      approvals[ceremony.name] = { ...entry, lastWarnedWindow: window };
      await writeApprovals(approvals);
      return;
    }

    await ceremony.run(now, outputDir);
  }

  async #dueWindow(opts: {
    config: Record<string, unknown>;
    now: Temporal.ZonedDateTime;
    threshold: Temporal.ZonedDateTime;
    outputDir: string;
    name: string;
  }): Promise<string | null> {
    const { config, now, threshold, outputDir, name } = opts;
    const intervalHours = typeof config.interval_hours === "number"
      ? config.interval_hours
      : null;
    const workdaysOnly = config.workdays_only === true;

    if (intervalHours !== null) {
      if (workdaysOnly && now.dayOfWeek > 5) return null;
      if (Temporal.ZonedDateTime.compare(now, threshold) < 0) return null;

      let mostRecent: Temporal.PlainDateTime | null = null;
      try {
        for await (const entry of readDir(outputDir)) {
          if (!entry.isFile || !entry.name.includes(name)) continue;
          const dt = parseTimestampPrefix(entry.name);
          if (
            dt !== null &&
            (mostRecent === null ||
              Temporal.PlainDateTime.compare(dt, mostRecent) > 0)
          ) {
            mostRecent = dt;
          }
        }
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }

      if (mostRecent === null) return compactTimestamp(threshold);
      const eligible = mostRecent.add({
        seconds: Math.round(intervalHours * 3600),
      });
      if (Temporal.PlainDateTime.compare(now.toPlainDateTime(), eligible) < 0) {
        return null;
      }
      return compactTimestamp(eligible.toZonedDateTime(now.timeZoneId));
    }

    if (Temporal.ZonedDateTime.compare(now, threshold) < 0) return null;

    const todayPrefix = String(now.year) +
      String(now.month).padStart(2, "0") +
      String(now.day).padStart(2, "0");

    try {
      for await (const entry of readDir(outputDir)) {
        if (entry.isFile && entry.name.startsWith(todayPrefix)) return null;
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

    return todayPrefix;
  }
}
