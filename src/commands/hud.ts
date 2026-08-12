import { join } from "@std/path";
import { lazyboyDir } from "../paths.ts";
import { bgGreen, bgRed, black, dim, inverse } from "@std/fmt/colors";
import {
  Input,
  matchesKey,
  ProcessTerminal,
  TUI,
} from "@earendil-works/pi-tui";
import { expandHome, loadConfig } from "../config.ts";
import { isLaunchdEnabled } from "../launchd.ts";
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
import { mkdir, open, readTextFile } from "../filesystem.ts";

const BLOCKED_COMMANDS = new Set(["hud", "shell", "tail", "review"]);

export function isBlockedCommand(name: string): boolean {
  return BLOCKED_COMMANDS.has(name);
}

export function parseCommand(
  input: string,
): { name: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  return { name: parts[0], args: parts.slice(1) };
}

export function formatTickLogLine(raw: string): string {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(raw);
  } catch {
    return raw;
  }
  const { ts = "", event = "", context = "", id = "", ...rest } = entry;
  let timeStr = "??:??:??";
  try {
    const zdt = Temporal.Instant.from(String(ts)).toZonedDateTimeISO(
      Temporal.Now.timeZoneId(),
    );
    timeStr = zdt.toString({
      fractionalSecondDigits: 0,
      offset: "never",
      timeZoneName: "never",
    });
  } catch {
    // malformed ts
  }
  const extras = Object.entries(rest)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const subject = context ? `${context}/${event}` : event;
  let line = `${dim(timeStr)} ${inverse(String(id))} ${subject}`;
  if (extras) {
    line += ` ${extras}`;
  }
  return line;
}

export function formatHudHeader(
  enabled: boolean,
  running: number,
  max: number,
): string {
  const badge = enabled
    ? bgGreen(black(" enabled "))
    : bgRed(black(" disabled "));
  return `${badge}  ${running}/${max} running`;
}

export function logPaneLines(lines: string[]): string[] {
  return lines.length === 0 ? [dim("(no logs)")] : lines;
}

export async function openLogWatch(parentDir: string): Promise<Deno.FsWatcher> {
  await mkdir(parentDir, { recursive: true });
  return Deno.watchFs(parentDir);
}

async function readState(
  stateDir: string,
  config: { tick: { concurrency: number } },
): Promise<{ header: string; statusLines: string[] }> {
  const [enabled, ids] = await Promise.all([
    isLaunchdEnabled(),
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
        t.shortTitle ?? t.title,
      )
    ),
  ];
  return {
    header: formatHudHeader(enabled, running, config.tick.concurrency),
    statusLines,
  };
}

export const HUD_CHROME_ROWS = 3;

export function paneHeights(
  { rows, inputRows }: { rows: number; inputRows: number },
): { status: number; log: number } {
  const available = Math.max(2, rows - inputRows - HUD_CHROME_ROWS);
  const status = Math.ceil(available / 2);
  return { status, log: available - status };
}

export const TICK_LOG_TAIL_LINES = 2000;
const TICK_LOG_TAIL_BYTES = 256 * 1024;

async function readTail(path: string, maxBytes: number): Promise<string> {
  const file = await open(path, { read: true });
  try {
    const { size } = await file.stat();
    if (size <= maxBytes) return await readTextFile(path);
    await file.seek(size - maxBytes, Deno.SeekMode.Start);
    const buffer = new Uint8Array(maxBytes);
    let read = 0;
    while (read < maxBytes) {
      const n = await file.read(buffer.subarray(read));
      if (n === null) break;
      read += n;
    }
    const text = new TextDecoder().decode(buffer.subarray(0, read));
    const firstBreak = text.indexOf("\n");
    return firstBreak === -1 ? "" : text.slice(firstBreak + 1);
  } finally {
    file.close();
  }
}

export async function readTickLog(tickLogPath: string): Promise<string[]> {
  let raw = "";
  try {
    raw = await readTail(tickLogPath, TICK_LOG_TAIL_BYTES);
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(-TICK_LOG_TAIL_LINES)
    .map(formatTickLogLine);
}

export const hud: Command = {
  name: "hud",
  description: "live status display",
  async run(_args) {
    const { commands } = await import("./registry.ts");
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    const parentDir = lazyboyDir();
    const tickLogPath = join(parentDir, "log.ndjson");

    const terminal = new ProcessTerminal();
    const tui = new TUI(terminal);

    let currentStatusLines: string[] = [];
    let currentLogLines: string[] = [];

    const commandInput = new Input();
    const commandInputFrame = {
      render(width: number): string[] {
        const border = "─".repeat(width);
        const colored = commandInput.focused ? border : dim(border);
        return [colored, ...commandInput.render(width), colored];
      },
      invalidate() {
        commandInput.invalidate();
      },
    };

    const layout = () =>
      paneHeights({
        rows: tui.terminal.rows,
        inputRows: commandInputFrame.render(tui.terminal.columns).length,
      });

    const statusPane = new ScrollPane({
      getLines: (_w) => currentStatusLines,
      tui,
      title: "status",
      getHeight: () => layout().status,
    });

    const logPane = new ScrollPane({
      getLines: (_w) => logPaneLines(currentLogLines),
      tui,
      title: "log",
      getHeight: () => layout().log,
    });

    let headerLine = "";
    const headerComponent = {
      render(_width: number): string[] {
        return [headerLine];
      },
      invalidate() {},
    };

    let commandRunning = false;

    tui.addChild(headerComponent);
    tui.addChild(statusPane);
    tui.addChild(logPane);
    tui.addChild(commandInputFrame);
    tui.setFocus(statusPane);
    statusPane.focused = true;
    logPane.focused = false;
    commandInput.focused = false;

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
      logPane.setContent((_w) => logPaneLines(currentLogLines));

      if (logWasAtEnd) {
        logPane.scrollToEnd();
      } else {
        logPane.scrollOffset = savedLogOffset;
      }

      tui.requestRender(true);
    }

    commandInput.onEscape = () => {
      commandInput.setValue("");
      commandInput.focused = false;
      statusPane.focused = true;
      logPane.focused = false;
      tui.setFocus(statusPane);
      tui.requestRender(true);
    };

    commandInput.onSubmit = async (value: string) => {
      if (commandRunning) return;
      const parsed = parseCommand(value);
      if (!parsed) return;
      const { name, args } = parsed;
      if (isBlockedCommand(name)) {
        headerLine = `Blocked: ${name}`;
        tui.requestRender(true);
        return;
      }
      if (!commands.find((c) => c.name === name)) {
        headerLine = `Unknown command: ${name}`;
        tui.requestRender(true);
        return;
      }
      commandInput.setValue("");
      commandRunning = true;
      const label = args.length > 0 ? `${name} ${args.join(" ")}` : name;
      headerLine = `Running: ${label}`;
      tui.requestRender(true);
      const scriptPath = new URL("../index.ts", import.meta.url).pathname;
      const proc = new Deno.Command("deno", {
        args: ["run", "--allow-all", scriptPath, name, ...args],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      const result = await proc.output();
      const combined = [
        new TextDecoder().decode(result.stdout),
        new TextDecoder().decode(result.stderr),
      ].join("\n");
      const lines = combined
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      let display: string;
      if (lines.length === 0) {
        display = result.code === 0 ? "OK" : `Error (exit ${result.code})`;
      } else {
        display = lines[0];
      }
      headerLine = display;
      tui.requestRender(true);
      commandRunning = false;
      setTimeout(() => refresh(), 3000);
    };

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
    const watchLog = await openLogWatch(parentDir);

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
          commandInput.focused = false;
          tui.setFocus(logPane);
        } else if (logPane.focused) {
          logPane.focused = false;
          commandInput.focused = true;
          statusPane.focused = false;
          tui.setFocus(commandInput);
        } else {
          commandInput.focused = false;
          statusPane.focused = true;
          logPane.focused = false;
          tui.setFocus(statusPane);
        }
        tui.requestRender(true);
      }
      if (matchesKey(data, "super+k")) {
        statusPane.focused = false;
        logPane.focused = false;
        commandInput.focused = true;
        tui.setFocus(commandInput);
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
