import {
  bold,
  cyan,
  dim,
  gray,
  green,
  italic,
  red,
  strikethrough,
  stripAnsiCode,
  underline,
  yellow,
} from "@std/fmt/colors";
import { join } from "@std/path";
import {
  type Component,
  Editor,
  type Focusable,
  KeybindingsManager,
  Markdown,
  type MarkdownTheme,
  matchesKey,
  type OverlayHandle,
  ProcessTerminal,
  setKeybindings,
  TUI,
  TUI_KEYBINDINGS,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { expandHome, loadConfig } from "./config.ts";
import {
  checkApfelAvailable,
  defaultCommandRunner,
  defaultProcessSpawner,
  startApfelServer,
} from "./apfel.ts";
import {
  commitTicket,
  readPhaseOutput,
  readTicket,
  writePhaseOutput,
  writeTicket,
} from "./state/store.ts";
import type { ApprovalEntry } from "./state/types.ts";
import { buildContextFiles } from "./run-phase.ts";
import { PHASE_SEQUENCE } from "./phases/types.ts";
import { compactTimestamp } from "./timestamp.ts";
import { diffLines } from "diff";
import { ScrollPane } from "./ui/scroll-pane.ts";
import {
  computeVisibleHeadingIndices,
  extractHeadings,
  renderTocLines,
} from "./ui/toc.ts";
import { readDir, readTextFile } from "./filesystem.ts";

const markdownTheme: MarkdownTheme = {
  heading: (s) => cyan(s),
  link: (s) => cyan(s),
  linkUrl: (s) => dim(s),
  code: (s) => yellow(s),
  codeBlock: (s) => s,
  codeBlockBorder: (s) => dim(s),
  quote: (s) => italic(s),
  quoteBorder: (s) => dim(s),
  hr: (s) => dim(s),
  listBullet: (s) => dim(s),
  bold: (s) => bold(s),
  italic: (s) => italic(s),
  strikethrough: (s) => strikethrough(s),
  underline: (s) => underline(s),
};

export function renderDiff(oldStr: string, newStr: string): string[] {
  const changes = diffLines(oldStr, newStr);
  const lines: string[] = [];
  for (const change of changes) {
    const parts = change.value.split("\n");
    if (parts[parts.length - 1] === "") parts.pop();
    for (const part of parts) {
      if (change.added) {
        lines.push(green(`+ ${part}`));
      } else if (change.removed) {
        lines.push(red(`- ${part}`));
      } else {
        lines.push(dim(`  ${part}`));
      }
    }
  }
  return lines;
}

export function wrapDiffLines(lines: string[], width: number): string[] {
  return lines.flatMap((line) => {
    const visible = stripAnsiCode(line);
    if (visible.length <= width) return [line];
    const visibleBody = visible.slice(2);
    if (!visibleBody.includes(" ")) return [line];
    const visiblePrefix = visible.slice(0, 2);
    const coloredPrefix = visiblePrefix === "+ "
      ? green(visiblePrefix)
      : visiblePrefix === "- "
      ? red(visiblePrefix)
      : dim(visiblePrefix);
    return wrapTextWithAnsi(visibleBody, width - 2).map((chunk) =>
      coloredPrefix + chunk
    );
  });
}

export async function findLatestPhaseOutput(
  ticketDir: string,
): Promise<
  | { filename: string; phaseName: string; previousFilename: string | null }
  | null
> {
  for (const phase of [...PHASE_SEQUENCE, "merge" as const].reverse()) {
    const outputPattern = new RegExp(`^\\d{8}T\\d{6}-${phase}\.md$`);
    const matches: string[] = [];
    try {
      for await (const entry of readDir(ticketDir)) {
        if (entry.isFile && outputPattern.test(entry.name)) {
          matches.push(entry.name);
        }
      }
    } catch {
      /* dir missing */
    }
    if (matches.length > 0) {
      matches.sort();
      return {
        filename: matches[matches.length - 1],
        phaseName: phase,
        previousFilename: matches.length >= 2
          ? matches[matches.length - 2]
          : null,
      };
    }
  }
  return null;
}

export async function classifyApproval(
  text: string,
  fetcher: typeof fetch,
  apfelUrl: string | null = null,
): Promise<boolean> {
  if (text.trim().length > 50) return false;
  if (apfelUrl !== null) {
    try {
      const response = await fetcher(`${apfelUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "apple-foundationmodel",
          max_tokens: 5,
          messages: [
            {
              role: "system",
              content:
                "The user is reviewing an AI-generated work product. Reply with exactly the word APPROVE if the user's message clearly expresses approval or acceptance (e.g. 'approved', 'looks good', 'good to go', 'lgtm', 'ship it'). Reply with exactly the word FEEDBACK for anything else, including questions, suggestions, corrections, ambiguous text, or anything unclear.",
            },
            { role: "user", content: text },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(
          `Approval detection failed: ${response.status} ${response.statusText}`,
        );
      }
      const data = await response.json();
      const result = (data?.choices?.[0]?.message?.content ?? "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, "");
      return result === "APPROVE";
    } catch (e) {
      throw e;
    }
  }
  try {
    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 5,
        system:
          "The user is reviewing an AI-generated work product. Reply with exactly the word APPROVE if the user's message clearly expresses approval or acceptance (e.g. 'approved', 'looks good', 'good to go', 'lgtm', 'ship it'). Reply with exactly the word FEEDBACK for anything else, including questions, suggestions, corrections, ambiguous text, or anything unclear.",
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Approval detection failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();
    const result = (data?.content?.[0]?.text ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    return result === "APPROVE";
  } catch (e) {
    throw e;
  }
}

export async function applyApproval(
  stateDir: string,
  id: string,
  now: Temporal.ZonedDateTime,
): Promise<void> {
  const ticket = await readTicket(stateDir, id);
  const entry: ApprovalEntry = {
    timestamp: now.toInstant().toString(),
    actor: "human",
    phase: ticket.phase,
  };
  await writeTicket(stateDir, {
    ...ticket,
    approvals: [...ticket.approvals, entry],
    updated: now.toInstant().toString(),
  });
  await commitTicket(stateDir, id, `approve: ${id}`);
}

export function formatTimestamp(now: Temporal.ZonedDateTime): string {
  return compactTimestamp(now);
}

export async function buildQuestionSystemPrompt(
  contextFiles: string[],
  readFile: (path: string | URL) => Promise<string> = readTextFile,
): Promise<string> {
  const parts: string[] = [
    "You are a helpful assistant answering questions about a ticket's phase output. The following are the ticket files:",
  ];
  for (const contextFile of contextFiles) {
    const path = contextFile.startsWith("@")
      ? contextFile.slice(1)
      : contextFile;
    try {
      const content = await readFile(path);
      parts.push(`\n---\n\n## ${path}\n\n${content}`);
    } catch {
      /* unreadable, skip */
    }
  }
  return parts.join("\n");
}

export async function answerQuestion(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  userText: string,
  systemPrompt: string,
  fetcher: typeof fetch,
): Promise<void> {
  messages.push({ role: "user", content: userText });
  try {
    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });
    if (!response.ok) {
      messages.push({
        role: "assistant",
        content: "Error: could not get a response.",
      });
      return;
    }
    const data = await response.json();
    const text = (data?.content?.[0]?.text ?? "").trim();
    messages.push({ role: "assistant", content: text });
  } catch {
    messages.push({
      role: "assistant",
      content: "Error: could not get a response.",
    });
  }
}

class QuestionOverlay implements Component, Focusable {
  private _focused = false;
  private messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  private pending = false;
  private editor: Editor;
  private handle: OverlayHandle | null = null;
  private onDismiss: (() => void) | null = null;

  constructor(
    private systemPrompt: string,
    private fetcher: typeof fetch,
    tui: TUI,
  ) {
    this.editor = new Editor(tui, {
      borderColor: (s) => s,
      selectList: {
        selectedPrefix: (s) => s,
        selectedText: (s) => s,
        description: (s) => s,
        scrollInfo: (s) => s,
        noMatch: (s) => s,
      },
    });
    this.editor.onSubmit = async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      this.editor.setText("");
      this.pending = true;
      tui.requestRender(true);
      await answerQuestion(
        this.messages,
        trimmed,
        this.systemPrompt,
        this.fetcher,
      );
      this.pending = false;
      tui.requestRender(true);
    };
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.editor.focused = value;
  }

  setHandle(handle: OverlayHandle, onDismiss: () => void): void {
    this.handle = handle;
    this.onDismiss = onDismiss;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.handle?.setHidden(true);
      this.onDismiss?.();
      return;
    }
    this.editor.handleInput?.(data);
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const msg of this.messages) {
      const label = msg.role === "user" ? dim("You:") : dim("Assistant:");
      lines.push(label);
      for (const line of wrapTextWithAnsi(msg.content, width - 2)) {
        lines.push(`  ${line}`);
      }
      lines.push("");
    }
    if (this.pending) {
      lines.push(dim("…"));
    }
    lines.push(...this.editor.render(width));
    return lines;
  }
}

export class ErrorOverlay implements Component, Focusable {
  private _focused = false;
  private message = "";
  private handle: OverlayHandle | null = null;
  private onDismiss: (() => void) | null = null;

  constructor(private tui: TUI) {}

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
  }

  setMessage(message: string): void {
    this.message = message;
  }

  setHandle(handle: OverlayHandle, onDismiss: () => void): void {
    this.handle = handle;
    this.onDismiss = onDismiss;
  }

  handleInput(_data: string): void {
    this.handle?.setHidden(true);
    this.onDismiss?.();
    this.tui.requestRender(true);
  }

  invalidate(): void {}

  render(width: number): string[] {
    return wrapTextWithAnsi(this.message, width);
  }
}

export async function review(
  id: string,
  {
    isTerminal = () => Deno.stdin.isTerminal(),
    readStdin = () => new Response(Deno.stdin.readable).text(),
  }: {
    isTerminal?: () => boolean;
    readStdin?: () => Promise<string>;
  } = {},
): Promise<void> {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const ticketDir = join(stateDir, id);

  const ticket = await readTicket(stateDir, id);

  if (ticket.status === "running") {
    console.error(`ticket ${id} is currently running`);
    Deno.exit(1);
  }

  if (ticket.status === "done") {
    console.error(`ticket ${id} is done`);
    Deno.exit(1);
  }

  const found = await findLatestPhaseOutput(ticketDir);
  if (!found) {
    console.error(`No phase output found for ${id}`);
    Deno.exit(1);
  }

  if (!isTerminal()) {
    const text = await readStdin();
    if (!text.trim()) {
      console.error("review input is empty");
      Deno.exit(1);
    }
    const now = Temporal.Now.zonedDateTimeISO("UTC");
    const timestamp = formatTimestamp(now);
    const feedbackFile = `${timestamp}-${found.phaseName}-feedback.md`;
    await writePhaseOutput(stateDir, id, feedbackFile, text);
    const updated = await readTicket(stateDir, id);
    await writeTicket(stateDir, {
      ...updated,
      status: "revising",
      updated: now.toInstant().toString(),
    });
    await commitTicket(stateDir, id, `review: ${id}`);
    Deno.exit(0);
  }

  const content = await readPhaseOutput(stateDir, id, found.filename);
  let paneContent: string | string[];
  let paneTitle: string;
  if (found.previousFilename !== null) {
    const previousContent = await readPhaseOutput(
      stateDir,
      id,
      found.previousFilename,
    );
    paneContent = renderDiff(previousContent, content);
    paneTitle = `${found.phaseName} (diff)`;
  } else {
    paneContent = content;
    paneTitle = found.phaseName;
  }

  const available = await checkApfelAvailable(defaultCommandRunner());
  const server = available
    ? await startApfelServer(defaultProcessSpawner(), fetch)
    : null;
  const killServer = () => server?.kill();

  const kb = new KeybindingsManager({
    ...TUI_KEYBINDINGS,
    "tui.input.submit": {
      defaultKeys: ["shift+enter"],
      description: "Submit input",
    },
    "tui.input.newLine": {
      defaultKeys: ["enter", "ctrl+j"],
      description: "Insert newline",
    },
  });
  setKeybindings(kb);

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  let focused: "content" | "editor" = "content";

  let contentGetLines: (width: number) => string[];
  let contentOnInvalidate: (() => void) | undefined;
  let headings: { level: number; title: string; sourceLine: number }[] = [];
  let totalSourceLines = 0;
  if (Array.isArray(paneContent)) {
    contentGetLines = (w) => wrapDiffLines(paneContent, w);
    contentOnInvalidate = undefined;
  } else {
    const md = new Markdown(paneContent, 1, 0, markdownTheme);
    const baseGetLines = (w: number) => md.render(w);
    headings = extractHeadings(paneContent);
    totalSourceLines = paneContent.split("\n").length;
    contentGetLines = baseGetLines;
    contentOnInvalidate = () => md.invalidate();
  }

  const editor = new Editor(tui, {
    borderColor: (s) => focused === "editor" ? s : gray(s),
    selectList: {
      selectedPrefix: (s) => s,
      selectedText: (s) => s,
      description: (s) => s,
      scrollInfo: (s) => s,
      noMatch: (s) => s,
    },
  });

  const contentPane = new ScrollPane({
    getLines: contentGetLines,
    tui,
    title: paneTitle,
    getHeight: () =>
      Math.max(
        1,
        tui.terminal.rows - editor.render(tui.terminal.columns).length - 1,
      ),
    onInvalidate: contentOnInvalidate,
    pinnedSidebar: Array.isArray(paneContent)
      ? undefined
      : (w, scrollState) =>
        renderTocLines(
          headings,
          w,
          computeVisibleHeadingIndices({
            headings,
            totalSourceLines,
            ...scrollState,
          }),
        ),
    pinnedSidebarWidth: Array.isArray(paneContent)
      ? undefined
      : (w) => (headings.length === 0 || w < 100 ? 0 : Math.floor(w / 3)),
  });

  tui.addChild(contentPane);
  tui.addChild(editor);
  tui.setFocus(contentPane);

  const contextFiles = await buildContextFiles({ ticketDir, stateDir });
  const systemPrompt = await buildQuestionSystemPrompt(contextFiles);
  const overlay = new QuestionOverlay(systemPrompt, fetch, tui);
  const overlayHandle = tui.showOverlay(overlay, {
    width: "80%",
    minWidth: 60,
    maxHeight: "80%",
    margin: 1,
  });
  overlayHandle.setHidden(true);
  overlay.setHandle(overlayHandle, () => {
    tui.setFocus(focused === "content" ? contentPane : editor);
    tui.requestRender(true);
  });

  const errorOverlay = new ErrorOverlay(tui);
  const errorOverlayHandle = tui.showOverlay(errorOverlay, {
    width: "80%",
    minWidth: 60,
    maxHeight: "80%",
    margin: 1,
  });
  errorOverlayHandle.setHidden(true);
  errorOverlay.setHandle(errorOverlayHandle, () => {
    tui.setFocus(editor);
    tui.requestRender(true);
  });

  const sigtermHandler = () => {
    killServer();
    tui.stop();
    Deno.exit(0);
  };
  Deno.addSignalListener("SIGTERM", sigtermHandler);

  async function handleSubmit(text: string): Promise<void> {
    if (!text.trim()) return;
    const now = Temporal.Now.zonedDateTimeISO("UTC");
    let isApproval: boolean;
    try {
      isApproval = await classifyApproval(text, fetch, server?.url ?? null);
    } catch (e) {
      errorOverlay.setMessage(e instanceof Error ? e.message : String(e));
      errorOverlayHandle.setHidden(false);
      errorOverlayHandle.focus();
      return;
    }
    if (isApproval) {
      await applyApproval(stateDir, id, now);
      killServer();
      Deno.removeSignalListener("SIGTERM", sigtermHandler);
      tui.stop();
      Deno.exit(0);
    }
    const timestamp = formatTimestamp(now);
    const feedbackFile = `${timestamp}-${found!.phaseName}-feedback.md`;
    await writePhaseOutput(stateDir, id, feedbackFile, text);
    const updated = await readTicket(stateDir, id);
    await writeTicket(stateDir, {
      ...updated,
      status: "revising",
      updated: now.toInstant().toString(),
    });
    await commitTicket(stateDir, id, `review: ${id}`);
    killServer();
    Deno.removeSignalListener("SIGTERM", sigtermHandler);
    tui.stop();
    Deno.exit(0);
  }

  editor.onSubmit = handleSubmit;

  tui.addInputListener((data) => {
    if (matchesKey(data, "ctrl+c")) {
      killServer();
      Deno.removeSignalListener("SIGTERM", sigtermHandler);
      tui.stop();
      Deno.exit(0);
    }
    if (matchesKey(data, "alt+shift+/")) {
      if (overlayHandle.isHidden()) {
        overlayHandle.setHidden(false);
        overlayHandle.focus();
      }
      return { consume: true };
    }
    if (matchesKey(data, "tab")) {
      if (focused === "content") {
        focused = "editor";
        tui.setFocus(editor);
      } else {
        focused = "content";
        tui.setFocus(contentPane);
      }
      tui.requestRender(true);
      return { consume: true };
    }
    if (matchesKey(data, "shift+enter")) {
      const text = editor.getExpandedText();
      if (text.trim()) {
        handleSubmit(text);
      }
      return { consume: true };
    }
  });

  tui.start();
}
