import {
  bold,
  cyan,
  dim,
  gray,
  italic,
  strikethrough,
  underline,
  yellow,
} from "@std/fmt/colors";
import { join } from "@std/path";
import {
  type Component,
  Editor,
  KeybindingsManager,
  Markdown,
  type MarkdownTheme,
  matchesKey,
  ProcessTerminal,
  setKeybindings,
  TUI,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { expandHome, loadConfig } from "./config.ts";
import {
  commitTicket,
  readPhaseOutput,
  readTicket,
  writePhaseOutput,
  writeTicket,
} from "./state/store.ts";
import { PHASE_SEQUENCE } from "./phases/types.ts";
import { compactTimestamp } from "./timestamp.ts";

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

export async function findLatestPhaseOutput(
  ticketDir: string,
): Promise<{ filename: string; phaseName: string } | null> {
  for (const phase of [...PHASE_SEQUENCE].reverse()) {
    const outputPattern = new RegExp(`^\\d{8}T\\d{6}-${phase}\.md$`);
    const matches: string[] = [];
    try {
      for await (const entry of Deno.readDir(ticketDir)) {
        if (entry.isFile && outputPattern.test(entry.name)) {
          matches.push(entry.name);
        }
      }
    } catch {
      /* dir missing */
    }
    if (matches.length > 0) {
      matches.sort();
      return { filename: matches[matches.length - 1], phaseName: phase };
    }
  }
  return null;
}

export async function classifyApproval(
  text: string,
  fetcher: typeof fetch,
): Promise<boolean> {
  if (text.trim().length > 20) return false;
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
          "The user is reviewing an AI-generated work product. Reply with exactly the word APPROVE if the user's message clearly expresses approval, acceptance, or intent to continue without changes (e.g. 'approved', 'looks good', 'continue', 'good to go', 'lgtm', 'ship it'). Reply with exactly the word FEEDBACK for anything else, including questions, suggestions, corrections, ambiguous text, or anything unclear.",
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    const result = (data?.content?.[0]?.text ?? "").trim().toUpperCase();
    return result === "APPROVE";
  } catch {
    return false;
  }
}

export async function applyApproval(
  stateDir: string,
  id: string,
  now: Temporal.ZonedDateTime,
): Promise<void> {
  const ticket = await readTicket(stateDir, id);
  await writeTicket(stateDir, {
    ...ticket,
    approved: true,
    updated: now.toInstant().toString(),
  });
  await commitTicket(stateDir, id, `approve: ${id}`);
}

export function formatTimestamp(now: Temporal.ZonedDateTime): string {
  return compactTimestamp(now);
}

class ContentPane implements Component {
  private md: Markdown;
  private scrollOffset = 0;
  private tui: TUI;
  private title: string;
  private editor?: Editor;

  constructor(content: string, tui: TUI, title: string) {
    this.md = new Markdown(content, 1, 0, markdownTheme);
    this.tui = tui;
    this.title = title;
  }

  setEditor(editor: Editor): void {
    this.editor = editor;
  }

  private editorHeight(width: number): number {
    if (this.editor) {
      return this.editor.render(width).length;
    }
    return Math.max(5, Math.floor(this.tui.terminal.rows * 0.3)) + 2;
  }

  private availableHeight(width: number): number {
    return Math.max(1, this.tui.terminal.rows - this.editorHeight(width) - 1);
  }

  private header(width: number): string {
    const label = ` ${this.title} `;
    const remaining = Math.max(0, width - label.length);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return dim("─".repeat(left) + label + "─".repeat(right));
  }

  handleInput(data: string): void {
    const width = this.tui.terminal.columns;
    if (matchesKey(data, "space") || matchesKey(data, "f")) {
      const height = this.availableHeight(width);
      const allLines = this.md.render(width);
      const maxOffset = Math.max(0, allLines.length - height);
      this.scrollOffset = Math.min(this.scrollOffset + height, maxOffset);
    }
    if (matchesKey(data, "b")) {
      const height = this.availableHeight(width);
      this.scrollOffset = Math.max(0, this.scrollOffset - height);
    }
  }

  invalidate(): void {
    this.md.invalidate();
  }

  render(width: number): string[] {
    const allLines = this.md.render(width);
    const height = this.availableHeight(width);
    const content = allLines.slice(
      this.scrollOffset,
      this.scrollOffset + height,
    );
    return [this.header(width), ...content];
  }
}

export async function review(id: string): Promise<void> {
  const config = await loadConfig();
  const stateDir = expandHome(config.state.dir);
  const ticketDir = join(stateDir, id);

  await readTicket(stateDir, id);

  const found = await findLatestPhaseOutput(ticketDir);
  if (!found) {
    console.error(`No phase output found for ${id}`);
    Deno.exit(1);
  }

  const content = await readPhaseOutput(stateDir, id, found.filename);

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

  const contentPane = new ContentPane(content, tui, found.phaseName);
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

  contentPane.setEditor(editor);

  tui.addChild(contentPane);
  tui.addChild(editor);
  tui.setFocus(contentPane);

  async function handleSubmit(text: string): Promise<void> {
    if (!text.trim()) return;
    const now = Temporal.Now.zonedDateTimeISO("UTC");
    if (await classifyApproval(text, fetch)) {
      await applyApproval(stateDir, id, now);
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
    tui.stop();
    Deno.exit(0);
  }

  editor.onSubmit = handleSubmit;

  tui.addInputListener((data) => {
    if (matchesKey(data, "ctrl+c")) {
      tui.stop();
      Deno.exit(0);
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
      const text = editor.getText();
      if (text.trim()) {
        handleSubmit(text);
      }
      return { consume: true };
    }
  });

  tui.start();
}
