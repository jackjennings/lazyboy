import { join } from "@std/path";
import { bgGreen, bgRed, white } from "@std/fmt/colors";
import { matchesKey, ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import { expandHome, loadConfig } from "../config.ts";
import { isCronEnabled } from "../cron.ts";
import { isPhaseAlive } from "../executor.ts";
import {
  compareTickets,
  formatStatusHeader,
  formatStatusRow,
  formatTokens,
  readTicketTokens,
  shouldHideTicket,
} from "./status.ts";
import { listTickets, readTicket } from "../state/store.ts";
import { ScrollPane } from "../ui/scroll-pane.ts";
import type { Command } from "./types.ts";

export function formatTickLogLine(raw: string): string {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(raw);
  } catch {
    return raw;
  }
  const ts = String(entry.ts ?? "");
  const event = String(entry.event ?? "");
  let timeStr = "??:??:??";
  try {
    const zdt = Temporal.Instant.from(ts).toZonedDateTimeISO(
      Temporal.Now.timeZoneId(),
    );
    timeStr = `${String(zdt.hour).padStart(2, "0")}:${
      String(zdt.minute).padStart(2, "0")
    }:${String(zdt.second).padStart(2, "0")}`;
  } catch {
    // malformed ts
  }
  const extras = Object.entries(entry)
    .filter(([k]) => k !== "ts" && k !== "event")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return extras ? `${timeStr} ${event} ${extras}` : `${timeStr} ${event}`;
}

export function formatHudHeader(
  enabled: boolean,
  running: number,
  max: number,
): string {
  const badge = enabled
    ? bgGreen(white(" enabled "))
    : bgRed(white(" disabled "));
  return `${badge}  ${running}/${max} running`;
}

async function readState(
  stateDir: string,
  config: { tick: { concurrency: number } },
): Promise<{ header: string; statusLines: string[] }> {
  const [enabled, ids] = await Promise.all([
    isCronEnabled(),
    listTickets(stateDir),
  ]);
  const tickets = await Promise.all(ids.map((id) => readTicket(stateDir, id)));
  tickets.sort(compareTickets);
  const visible = tickets.filter((t) => !shouldHideTicket(t.phase, t.status));
  const tokenTotals = await Promise.all(
    visible.map((t) => readTicketTokens(join(stateDir, t.id))),
  );
  const running = tickets.filter(
    (t) => t.status === "running" && isPhaseAlive(join(stateDir, t.id)),
  ).length;
  const statusLines = [
    ...formatStatusHeader().split("\n"),
    ...visible.map((t, i) =>
      formatStatusRow(
        t.id,
        t.phase,
        t.status,
        t.approvals,
        formatTokens(tokenTotals[i]),
        t.title,
      )
    ),
  ];
  return {
    header: formatHudHeader(enabled, running, config.tick.concurrency),
    statusLines,
  };
}

async function readTickLog(tickLogPath: string): Promise<string[]> {
  let raw = "";
  try {
    raw = await Deno.readTextFile(tickLogPath);
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map(formatTickLogLine);
}

export const hud: Command = {
  name: "hud",
  description: "live status display",
  async run(_args) {
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    const tickLogPath = join(Deno.env.get("HOME")!, ".lazyboy", "tick.ndjson");

    const terminal = new ProcessTerminal();
    const tui = new TUI(terminal);

    let currentStatusLines: string[] = [];
    let currentLogLines: string[] = [];

    const statusPane = new ScrollPane({
      getLines: (_w) => currentStatusLines,
      tui,
      title: "status",
      getHeight: () => Math.ceil((tui.terminal.rows - 1) / 2),
    });

    const logPane = new ScrollPane({
      getLines: (_w) => currentLogLines,
      tui,
      title: "tick log",
      getHeight: () =>
        tui.terminal.rows - 1 - Math.ceil((tui.terminal.rows - 1) / 2),
    });

    let headerLine = "";
    const headerComponent = {
      render(_width: number): string[] {
        return [headerLine];
      },
      invalidate() {},
    };

    tui.addChild(headerComponent);
    tui.addChild(statusPane);
    tui.addChild(logPane);
    tui.setFocus(statusPane);
    statusPane.focused = true;
    logPane.focused = false;

    async function refresh() {
      const logWasAtEnd = logPane.isAtEnd(tui.terminal.columns);
      const savedLogOffset = logPane.scrollOffset;

      const [{ header, statusLines }, logLines] = await Promise.all([
        readState(stateDir, config),
        readTickLog(tickLogPath),
      ]);

      headerLine = header;
      currentStatusLines = statusLines;
      currentLogLines = logLines;
      statusPane.setContent((_w) => currentStatusLines);
      logPane.setContent((_w) => currentLogLines);

      if (logWasAtEnd) {
        logPane.scrollToEnd();
      } else {
        logPane.scrollOffset = savedLogOffset;
      }

      tui.requestRender(true);
    }

    await refresh();
    logPane.scrollToEnd();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleRefresh() {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        refresh();
      }, 200);
    }

    const watchState = Deno.watchFs(stateDir, { recursive: true });
    const watchLog = Deno.watchFs(tickLogPath);

    (async () => {
      for await (const _event of watchState) {
        scheduleRefresh();
      }
    })();

    (async () => {
      for await (const _event of watchLog) {
        scheduleRefresh();
      }
    })();

    tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+c")) {
        tui.stop();
        Deno.exit(0);
      }
      if (matchesKey(data, "tab")) {
        if (statusPane.focused) {
          statusPane.focused = false;
          logPane.focused = true;
          tui.setFocus(logPane);
        } else {
          logPane.focused = false;
          statusPane.focused = true;
          tui.setFocus(statusPane);
        }
        tui.requestRender(true);
      }
    });

    const sigtermHandler = () => {
      tui.stop();
      Deno.exit(0);
    };
    Deno.addSignalListener("SIGTERM", sigtermHandler);

    tui.start();
  },
};
