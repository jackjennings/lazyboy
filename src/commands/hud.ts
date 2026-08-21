import { join } from "@std/path";
import { urrasDir } from "../paths.ts";
import { bgGreen, bgRed, black, dim, inverse } from "@std/fmt/colors";
import {
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  Editor,
  type EditorTheme,
  isKeyRelease,
  matchesKey,
  ProcessTerminal,
  TUI,
} from "@earendil-works/pi-tui";
import { expandHome, loadConfig } from "../config.ts";
import { isLaunchdEnabled } from "../launchd.ts";
import { isPhaseAlive } from "../executor.ts";
import {
  compareTickets,
  formatBrokenRow,
  formatStatusHeader,
  formatStatusRow,
  formatTokens,
  readTicketTokens,
  shouldHideTicket,
} from "./status.ts";
import { listTickets, readTicket } from "../state/store.ts";
import type { TicketState } from "../state/types.ts";
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
  progress?: string,
): string {
  const badge = enabled
    ? bgGreen(black(" enabled "))
    : bgRed(black(" disabled "));
  const base = `${badge}  ${running}/${max} running`;
  return progress ? `${base}  ${progress}` : base;
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
  const settled = await Promise.allSettled(
    ids.map((id) => readTicket(stateDir, id)),
  );
  const tickets: TicketState[] = [];
  const brokenRows: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      tickets.push(result.value);
    } else {
      const err = result.reason;
      brokenRows.push(
        formatBrokenRow(
          ids[i],
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }
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
    ...brokenRows,
  ];
  let progress: string | undefined;
  try {
    const raw = await readTextFile(
      join(urrasDir(), "tick-progress.json"),
    );
    const data = JSON.parse(raw) as { label?: string };
    if (data.label) progress = data.label;
  } catch {
    // missing or unparseable
  }
  return {
    header: formatHudHeader(
      enabled,
      running,
      config.tick.concurrency,
      progress,
    ),
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

export interface HudAutocompleteProviderDeps {
  commands: Array<Pick<Command, "name" | "description" | "completesWith">>;
  listTickets: (stateDir?: string) => Promise<string[]>;
}

export function hudAutocompleteProvider(
  deps: HudAutocompleteProviderDeps,
): AutocompleteProvider {
  return {
    getSuggestions(
      lines: string[],
      _cursorLine: number,
      cursorCol: number,
      { signal }: { signal: AbortSignal },
    ): Promise<AutocompleteSuggestions | null> {
      if (signal.aborted) return Promise.resolve(null);
      const text = lines[0].slice(0, cursorCol);
      const spaceIndex = text.search(/\s/);
      if (spaceIndex === -1) {
        const prefix = text;
        const items = deps.commands
          .filter(
            (c) => !isBlockedCommand(c.name) && !c.name.startsWith("_"),
          )
          .map((c) => ({
            value: c.name,
            label: c.name,
            description: c.description ?? "",
          }));
        return Promise.resolve({ items, prefix });
      }
      const token1 = text.slice(0, spaceIndex);
      const prefix = lines[0].split(/\s/).pop() ?? "";
      const cmd = deps.commands.find((c) => c.name === token1);
      if (!cmd || cmd.completesWith === undefined) return Promise.resolve(null);
      if (cmd.completesWith === "_ids") {
        return deps.listTickets().then((ids) => {
          if (signal.aborted) return null;
          return {
            items: ids.map((id) => ({ value: id, label: id })),
            prefix,
          };
        });
      }
      return Promise.resolve({
        items: cmd.completesWith.map((s) => ({ value: s, label: s })),
        prefix,
      });
    },
    applyCompletion(
      lines: string[],
      _cursorLine: number,
      cursorCol: number,
      item: AutocompleteItem,
      prefix: string,
    ) {
      const before = lines[0].slice(0, cursorCol - prefix.length);
      const after = lines[0].slice(cursorCol);
      const newLine = before + item.value + after;
      return {
        lines: [newLine],
        cursorLine: 0,
        cursorCol: cursorCol - prefix.length + item.value.length,
      };
    },
  };
}

export const hud: Command = {
  name: "hud",
  description: "live status display",
  async run(_args) {
    const { commands } = await import("./registry.ts");
    const config = await loadConfig();
    const stateDir = expandHome(config.state.dir);
    const parentDir = urrasDir();
    const tickLogPath = join(parentDir, "log.ndjson");

    const terminal = new ProcessTerminal();
    const tui = new TUI(terminal);

    let currentStatusLines: string[] = [];
    let currentLogLines: string[] = [];

    const editorTheme: EditorTheme = {
      borderColor: (str: string) => dim(str),
      selectList: {
        selectedPrefix: (text: string) => inverse(text),
        selectedText: (text: string) => inverse(text),
        description: (text: string) => dim(text),
        scrollInfo: (text: string) => dim(text),
        noMatch: (text: string) => text,
      },
    };
    const commandEditor = new Editor(tui, editorTheme);
    commandEditor.setAutocompleteProvider(
      hudAutocompleteProvider({
        commands,
        listTickets: () => listTickets(stateDir),
      }),
    );

    const layout = () =>
      paneHeights({
        rows: tui.terminal.rows,
        inputRows: commandEditor.render(tui.terminal.columns).length,
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
    tui.addChild(commandEditor);
    tui.setFocus(statusPane);
    statusPane.focused = true;
    logPane.focused = false;
    commandEditor.focused = false;

    async function refresh() {
      const logWasAtEnd = logPane.isAtEnd(tui.terminal.columns);
      const savedLogOffset = logPane.scrollOffset;
      const savedStatusOffset = statusPane.scrollOffset;

      const [{ header, statusLines }, logLines] = await Promise.all([
        readState(stateDir, config),
        readTickLog(tickLogPath),
      ]);

      headerLine = header;
      currentStatusLines = statusLines;
      currentLogLines = logLines;
      statusPane.setContent((_w) => currentStatusLines);
      statusPane.scrollOffset = savedStatusOffset;
      logPane.setContent((_w) => logPaneLines(currentLogLines));

      if (logWasAtEnd) {
        logPane.scrollToEnd();
      } else {
        logPane.scrollOffset = savedLogOffset;
      }

      tui.requestRender(true);
    }

    commandEditor.onSubmit = async (value: string) => {
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
      commandEditor.setText("");
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
      if (isKeyRelease(data)) {
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+c")) {
        tui.stop();
        Deno.exit(0);
      }
      if (matchesKey(data, "escape")) {
        if (commandEditor.focused && !commandEditor.isShowingAutocomplete()) {
          commandEditor.setText("");
          commandEditor.focused = false;
          statusPane.focused = true;
          logPane.focused = false;
          tui.setFocus(statusPane);
          tui.requestRender(true);
          return { consume: true };
        }
      }
      if (matchesKey(data, "tab")) {
        if (commandEditor.focused && commandEditor.getText() !== "") {
          return;
        }
        if (statusPane.focused) {
          statusPane.focused = false;
          logPane.focused = true;
          commandEditor.focused = false;
          tui.setFocus(logPane);
        } else if (logPane.focused) {
          logPane.focused = false;
          commandEditor.focused = true;
          statusPane.focused = false;
          tui.setFocus(commandEditor);
        } else {
          commandEditor.focused = false;
          statusPane.focused = true;
          logPane.focused = false;
          tui.setFocus(statusPane);
        }
        tui.requestRender(true);
      }
      if (matchesKey(data, "super+k")) {
        statusPane.focused = false;
        logPane.focused = false;
        commandEditor.focused = true;
        tui.setFocus(commandEditor);
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
